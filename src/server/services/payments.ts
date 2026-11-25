import crypto from 'node:crypto';
import type { ServerConfig } from '../config.ts';
import type { GatewayMode, PaymentStatus } from '../../shared/types.ts';

export interface GatewayRuntimeConfig {
  gatewayMode: GatewayMode;
  gatewayUrl: string;
  merchantId: string;
  apiVersion: string;
  apiKey: string;
  webhookSecret: string;
  source: 'admin' | 'env' | 'none';
}

export interface InitiatePaymentInput {
  orderId: string;
  orderReference: string;
  transactionReference: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  returnUrl: string;
}

export interface InitiatePaymentResult {
  providerPaymentId: string | null;
  status: PaymentStatus;
  redirectUrl?: string;
  requiresManualVerification: boolean;
  gatewayMetadata?: Record<string, unknown>;
}

export interface VerifyReturnResult {
  verified: boolean;
  providerPaymentId: string | null;
  reason?: string;
}

export interface GatewayTestResult {
  ok: boolean;
  mode: GatewayMode;
  message: string;
}

export interface VerifiedWebhookEvent {
  externalEventId: string;
  eventType: string;
  transactionReference: string;
  providerPaymentId: string | null;
  targetStatus: 'verified' | 'failed' | 'cancelled' | 'refunded';
  failureReason?: string;
  amountCents?: number;
  currency?: string;
}

export interface PaymentProviderAdapter {
  readonly code: string;
  readonly providerType: 'online_gateway' | 'manual';
  isConnected(): Promise<boolean>;
  missingRequirements(): Promise<string[]>;
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  verifyWebhookSignature(rawBody: string, headers: Record<string, string | undefined>): Promise<boolean>;
  parseWebhookEvent(rawBody: string): VerifiedWebhookEvent;
  verifyHostedReturn?(params: {
    orderReference: string;
    transactionReference: string;
    amountCents: number;
    currency?: string;
    resultIndicator?: string;
    metadata?: Record<string, unknown>;
  }): Promise<VerifyReturnResult>;
  testConnection?(): Promise<GatewayTestResult>;
}

function timingSafeCompare(aStr: string, bStr: string): boolean {
  const a = Buffer.from(aStr.trim());
  const b = Buffer.from(bStr.trim());
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export class PremierBankGatewayAdapter implements PaymentProviderAdapter {
  readonly code = 'premier_bank_gateway';
  readonly providerType = 'online_gateway' as const;

  constructor(
    private readonly config: ServerConfig,
    private readonly resolveRuntimeConfig: () => Promise<GatewayRuntimeConfig> | GatewayRuntimeConfig
  ) {}

  private async runtime(): Promise<GatewayRuntimeConfig> {
    return await this.resolveRuntimeConfig();
  }

  async isConnected(): Promise<boolean> {
    const rt = await this.runtime();
    if (!rt.gatewayUrl || !rt.merchantId || !rt.apiKey) return false;
    // MPGS Hosted Checkout supports return verification + optional webhook secret; REST redirect requires webhookSecret
    if (rt.gatewayMode === 'rest_redirect' && !rt.webhookSecret) {
      return false;
    }
    return true;
  }

  async missingRequirements(): Promise<string[]> {
    const rt = await this.runtime();
    const missing: string[] = [];
    if (!rt.gatewayUrl) missing.push('PREMIER_BANK_GATEWAY_URL');
    if (!rt.merchantId) missing.push('PREMIER_BANK_MERCHANT_ID');
    if (!rt.apiKey) missing.push('PREMIER_BANK_API_KEY');
    if (rt.gatewayMode === 'rest_redirect' && !rt.webhookSecret) {
      missing.push('PREMIER_BANK_WEBHOOK_SECRET');
    }
    return missing;
  }

  private buildMpgsUrls(rt: GatewayRuntimeConfig) {
    const parsed = new URL(rt.gatewayUrl);
    const origin = parsed.origin;
    const version = (rt.apiVersion || '73').replace(/[^0-9]/g, '') || '73';
    const sessionEndpoint = rt.gatewayUrl.endsWith('/session')
      ? rt.gatewayUrl
      : `${origin}/api/rest/version/${version}/merchant/${encodeURIComponent(rt.merchantId)}/session`;
    const orderEndpointBase = `${origin}/api/rest/version/${version}/merchant/${encodeURIComponent(rt.merchantId)}/order`;
    const authHeader = `Basic ${Buffer.from(`merchant.${rt.merchantId}:${rt.apiKey}`).toString('base64')}`;
    return { origin, version, sessionEndpoint, orderEndpointBase, authHeader };
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (!(await this.isConnected())) {
      throw new Error(
        'Card payment via Premier Bank (Mastercard / Visa) is not currently available. Please choose another payment method or try again later.'
      );
    }

    const rt = await this.runtime();
    if (rt.gatewayMode === 'mpgs_hosted') {
      return this.initiateMpgsHostedCheckout(rt, input);
    }
    return this.initiateRestRedirectCheckout(rt, input);
  }

  private async initiateMpgsHostedCheckout(
    rt: GatewayRuntimeConfig,
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentResult> {
    const { origin, sessionEndpoint, authHeader } = this.buildMpgsUrls(rt);
    const returnUrl = `${input.returnUrl}?order=${encodeURIComponent(input.orderReference)}&provider=premier_bank_gateway`;
    const cancelUrl = `${input.returnUrl}?order=${encodeURIComponent(input.orderReference)}&status=cancelled`;

    const res = await fetch(sessionEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        apiOperation: 'INITIATE_CHECKOUT',
        interaction: {
          operation: 'PURCHASE',
          returnUrl,
          cancelUrl,
          merchant: {
            name: 'Khalid Sharif Digital Library',
          },
        },
        order: {
          id: input.orderReference,
          amount: (input.amountCents / 100).toFixed(2),
          currency: input.currency,
          reference: input.transactionReference,
          description: `Digital books order ${input.orderReference}`,
        },
        customer: {
          email: input.customerEmail,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[Payments] Hosted card checkout session failed:', res.status, errText.slice(0, 300));
      throw new Error('Unable to start card payment right now. Please try again or choose another payment method.');
    }

    const data = (await res.json()) as {
      result?: string;
      session?: { id?: string; updateStatus?: string };
      successIndicator?: string;
      redirectUrl?: string;
      checkoutUrl?: string;
    };

    const sessionId = data.session?.id || '';
    const redirectUrl =
      data.redirectUrl ||
      data.checkoutUrl ||
      (sessionId ? `${origin}/checkout/pay/${encodeURIComponent(sessionId)}?checkoutVersion=1.0.0` : '');

    if (!redirectUrl) {
      console.error('[Payments] Hosted card checkout did not return a session ID or checkout URL');
      throw new Error('Unable to open the card payment page right now. Please try again.');
    }

    return {
      providerPaymentId: sessionId || null,
      status: 'processing',
      redirectUrl,
      requiresManualVerification: false,
      gatewayMetadata: {
        gatewayMode: 'mpgs_hosted',
        sessionId,
        successIndicator: data.successIndicator || '',
        expectedAmountCents: input.amountCents,
        expectedCurrency: input.currency,
      },
    };
  }

  private async initiateRestRedirectCheckout(
    rt: GatewayRuntimeConfig,
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentResult> {
    const res = await fetch(rt.gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rt.apiKey}`,
        'X-Merchant-Id': rt.merchantId,
      },
      body: JSON.stringify({
        merchantId: rt.merchantId,
        orderId: input.orderId,
        orderReference: input.orderReference,
        transactionReference: input.transactionReference,
        amount: (input.amountCents / 100).toFixed(2),
        amountCents: input.amountCents,
        currency: input.currency,
        cardNetworks: ['MASTERCARD', 'VISA'],
        customerEmail: input.customerEmail,
        returnUrl: `${input.returnUrl}?order=${encodeURIComponent(input.orderReference)}&provider=premier_bank_gateway`,
        cancelUrl: `${input.returnUrl}?order=${encodeURIComponent(input.orderReference)}&status=cancelled`,
        callbackUrl: `${this.config.appUrl.replace(/\/+$/, '')}/api/webhooks/payments/premier_bank_gateway`,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[Payments] Premier Bank initiation failed:', res.status, errText.slice(0, 300));
      throw new Error('Unable to start card payment right now. Please try again or choose another payment method.');
    }

    const data = (await res.json()) as {
      providerPaymentId?: string;
      transactionId?: string;
      sessionId?: string;
      redirectUrl?: string;
      checkoutUrl?: string;
    };

    const redirectUrl = data.redirectUrl || data.checkoutUrl;
    if (!redirectUrl) {
      console.error('[Payments] Premier Bank initiation did not return a valid checkout URL');
      throw new Error('Unable to open the card payment page right now. Please try again.');
    }

    return {
      providerPaymentId: data.providerPaymentId || data.transactionId || data.sessionId || null,
      status: 'processing',
      redirectUrl,
      requiresManualVerification: false,
      gatewayMetadata: {
        gatewayMode: 'rest_redirect',
        sessionId: data.sessionId || null,
      },
    };
  }

  async verifyHostedReturn(params: {
    orderReference: string;
    transactionReference: string;
    amountCents: number;
    currency?: string;
    resultIndicator?: string;
    metadata?: Record<string, unknown>;
  }): Promise<VerifyReturnResult> {
    if (!(await this.isConnected())) {
      return { verified: false, providerPaymentId: null, reason: 'Card payment is temporarily unavailable.' };
    }
    const rt = await this.runtime();
    if (rt.gatewayMode !== 'mpgs_hosted') {
      return { verified: false, providerPaymentId: null, reason: 'Awaiting payment confirmation' };
    }

    const storedIndicator = typeof params.metadata?.successIndicator === 'string' ? params.metadata.successIndicator : '';
    const storedSessionId = typeof params.metadata?.sessionId === 'string' ? params.metadata.sessionId : null;
    const expectedAmount = typeof params.metadata?.expectedAmountCents === 'number' ? params.metadata.expectedAmountCents : null;
    const expectedCurrency = typeof params.metadata?.expectedCurrency === 'string' ? params.metadata.expectedCurrency : null;

    if (expectedAmount !== null && expectedAmount !== params.amountCents) {
      return { verified: false, providerPaymentId: storedSessionId, reason: 'Payment amount mismatch' };
    }
    if (expectedCurrency && params.currency && expectedCurrency.toUpperCase() !== params.currency.toUpperCase()) {
      return { verified: false, providerPaymentId: storedSessionId, reason: 'Payment currency mismatch' };
    }

    if (params.resultIndicator && storedIndicator && timingSafeCompare(params.resultIndicator, storedIndicator)) {
      return {
        verified: true,
        providerPaymentId: storedSessionId || params.orderReference,
      };
    }

    // Fallback: Query MPGS Order API directly server-to-server
    try {
      const { orderEndpointBase, authHeader } = this.buildMpgsUrls(rt);
      const res = await fetch(`${orderEndpointBase}/${encodeURIComponent(params.orderReference)}`, {
        method: 'GET',
        headers: { Authorization: authHeader },
      });
      if (!res.ok) {
        console.error('[Payments] Order verification check returned status:', res.status);
        return {
          verified: false,
          providerPaymentId: storedSessionId,
          reason: 'Unable to confirm payment right now. Please try again shortly.',
        };
      }
      const data = (await res.json()) as {
        id?: string;
        result?: string;
        status?: string;
        totalCapturedAmount?: number;
        amount?: number;
        currency?: string;
      };
      const status = (data.status || '').toUpperCase();
      const result = (data.result || '').toUpperCase();
      if (result === 'SUCCESS' && ['CAPTURED', 'AUTHORIZED', 'PURCHASED', ''].includes(status)) {
        const rawAmount = data.totalCapturedAmount ?? data.amount;
        if (typeof rawAmount === 'number' && Number.isFinite(rawAmount)) {
          if (Math.round(rawAmount * 100) !== params.amountCents) {
            return {
              verified: false,
              providerPaymentId: data.id || storedSessionId,
              reason: 'Payment amount mismatch',
            };
          }
        }
        if (data.currency && params.currency && data.currency.toUpperCase() !== params.currency.toUpperCase()) {
          return {
            verified: false,
            providerPaymentId: data.id || storedSessionId,
            reason: 'Payment currency mismatch',
          };
        }
        return {
          verified: true,
          providerPaymentId: data.id || storedSessionId || params.orderReference,
        };
      }
      return { verified: false, providerPaymentId: storedSessionId, reason: 'Awaiting payment confirmation' };
    } catch (err) {
      console.error('[Payments] Order verification network error:', err);
      return {
        verified: false,
        providerPaymentId: storedSessionId,
        reason: 'Unable to confirm payment right now. Please try again shortly.',
      };
    }
  }

  async testConnection(): Promise<GatewayTestResult> {
    const rt = await this.runtime();
    if (!(await this.isConnected())) {
      const missing = await this.missingRequirements();
      return {
        ok: false,
        mode: rt.gatewayMode,
        message: `Missing required fields: ${missing.join(', ')}`,
      };
    }

    if (rt.gatewayMode === 'mpgs_hosted') {
      try {
        const { orderEndpointBase, authHeader } = this.buildMpgsUrls(rt);
        // Probe an expected-missing order ID to verify TLS reachability + Basic Auth credentials safely without creating a charge
        const probeRes = await fetch(`${orderEndpointBase}/KSDL-HEALTHCHECK-PROBE`, {
          method: 'GET',
          headers: { Authorization: authHeader },
        });
        if (probeRes.status === 401 || probeRes.status === 403) {
          return {
            ok: false,
            mode: rt.gatewayMode,
            message: 'Gateway rejected Merchant ID or API Password (HTTP 401/403). Please verify your credentials.',
          };
        }
        return {
          ok: true,
          mode: rt.gatewayMode,
          message: `Connected to Mastercard Hosted Checkout (${new URL(rt.gatewayUrl).host}). Ready for live or sandbox payments.`,
        };
      } catch (err) {
        return {
          ok: false,
          mode: rt.gatewayMode,
          message: `Saved credentials, but gateway host could not be reached from this server (${err instanceof Error ? err.message : 'network error'}).`,
        };
      }
    }

    return {
      ok: true,
      mode: rt.gatewayMode,
      message: 'Premier Bank REST Redirect credentials are saved and active.',
    };
  }

  async verifyWebhookSignature(rawBody: string, headers: Record<string, string | undefined>): Promise<boolean> {
    const rt = await this.runtime();
    if (!rt.webhookSecret) return false;

    const mpgsSecretHeader = headers['x-notification-secret'];
    if (mpgsSecretHeader && timingSafeCompare(mpgsSecretHeader, rt.webhookSecret)) {
      return true;
    }

    const signature = headers['x-premier-signature'] || headers['x-webhook-signature'];
    if (!signature) return false;

    const expected = crypto.createHmac('sha256', rt.webhookSecret).update(rawBody).digest('hex');
    return timingSafeCompare(signature, expected);
  }

  parseWebhookEvent(rawBody: string): VerifiedWebhookEvent {
    const payload = JSON.parse(rawBody) as {
      eventId?: string;
      id?: string;
      eventType?: string;
      transactionReference?: string;
      reference?: string;
      providerPaymentId?: string;
      transactionId?: string;
      status?: string;
      result?: string;
      failureReason?: string;
      amountCents?: number;
      amount?: number | string;
      currency?: string;
      order?: {
        id?: string;
        reference?: string;
        status?: string;
        amount?: number | string;
        totalCapturedAmount?: number | string;
        currency?: string;
      };
      transaction?: {
        id?: string;
        reference?: string;
        type?: string;
        amount?: number | string;
        currency?: string;
      };
    };

    const externalEventId =
      payload.eventId || payload.id || payload.transaction?.id || payload.order?.id || '';
    const txRef =
      payload.transactionReference ||
      payload.reference ||
      payload.transaction?.reference ||
      payload.order?.reference ||
      payload.order?.id ||
      '';
    if (!externalEventId || !txRef) {
      throw new Error('Invalid payment webhook payload: missing eventId or transaction/order reference');
    }

    const normalized = (
      payload.status ||
      payload.order?.status ||
      payload.result ||
      ''
    ).toLowerCase();
    let targetStatus: VerifiedWebhookEvent['targetStatus'] = 'failed';
    if (['verified', 'approved', 'success', 'succeeded', 'captured', 'paid', 'authorized'].includes(normalized)) {
      targetStatus = 'verified';
    } else if (['cancelled', 'canceled'].includes(normalized)) {
      targetStatus = 'cancelled';
    } else if (['refunded', 'refund'].includes(normalized)) {
      targetStatus = 'refunded';
    }

    let amountCents: number | undefined;
    if (typeof payload.amountCents === 'number' && Number.isFinite(payload.amountCents)) {
      amountCents = Math.round(payload.amountCents);
    } else {
      const majorRaw =
        payload.amount ??
        payload.order?.totalCapturedAmount ??
        payload.order?.amount ??
        payload.transaction?.amount;
      if (majorRaw !== undefined && majorRaw !== null && majorRaw !== '') {
        const num = Number(majorRaw);
        if (Number.isFinite(num)) {
          amountCents = Math.round(num * 100);
        }
      }
    }

    const currencyRaw = payload.currency || payload.order?.currency || payload.transaction?.currency;
    const currency = typeof currencyRaw === 'string' && currencyRaw.trim() ? currencyRaw.trim().toUpperCase() : undefined;

    return {
      externalEventId,
      eventType: payload.eventType || payload.transaction?.type || 'premier_bank.card_payment',
      transactionReference: txRef,
      providerPaymentId: payload.providerPaymentId || payload.transactionId || payload.transaction?.id || null,
      targetStatus,
      failureReason: payload.failureReason,
      amountCents,
      currency,
    };
  }
}

export class ManualTransferAdapter implements PaymentProviderAdapter {
  constructor(readonly code = 'manual_transfer') {}
  readonly providerType = 'manual' as const;

  async isConnected(): Promise<boolean> {
    return true;
  }

  async missingRequirements(): Promise<string[]> {
    return [];
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    return {
      providerPaymentId: `MANUAL-${input.transactionReference}`,
      status: 'pending_verification',
      requiresManualVerification: true,
    };
  }

  async verifyWebhookSignature(): Promise<boolean> {
    return false;
  }

  parseWebhookEvent(): VerifiedWebhookEvent {
    throw new Error('Manual transfer does not support external webhooks');
  }
}

export function createPaymentAdapterRegistry(
  config: ServerConfig,
  resolvePremierConfig?: () => Promise<GatewayRuntimeConfig> | GatewayRuntimeConfig
): Map<string, PaymentProviderAdapter> {
  const registry = new Map<string, PaymentProviderAdapter>();
  const resolver =
    resolvePremierConfig ||
    (() => ({
      gatewayMode: 'rest_redirect',
      gatewayUrl: config.premierBankGatewayUrl,
      merchantId: config.premierBankMerchantId,
      apiVersion: '73',
      apiKey: config.premierBankApiKey,
      webhookSecret: config.premierBankWebhookSecret,
      source: config.premierBankGatewayUrl ? 'env' : 'none',
    }));

  const premierBank = new PremierBankGatewayAdapter(config, resolver);
  const manual = new ManualTransferAdapter();

  registry.set(premierBank.code, premierBank);
  registry.set(manual.code, manual);
  return registry;
}
