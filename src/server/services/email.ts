import type { ServerConfig } from '../config.ts';

export interface EmailSendResult {
  sent: boolean;
  status: 'sent' | 'not_configured' | 'failed';
  provider: string;
  messageId?: string;
  reason?: string;
}

export interface EmailService {
  isConfigured(): boolean;
  send(params: { to: string; subject: string; html: string; text: string }): Promise<EmailSendResult>;
}

export function createEmailService(config: ServerConfig): EmailService {
  const isConfigured = Boolean(config.resendApiKey);

  return {
    isConfigured: () => isConfigured,

    async send(params) {
      if (!config.resendApiKey) {
        return {
          sent: false,
          status: 'not_configured',
          provider: 'resend',
          reason: 'Email delivery is currently unavailable. Please contact support for assistance.',
        };
      }

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: config.emailFrom,
            to: [params.to],
            subject: params.subject,
            html: params.html,
            text: params.text,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error('[Email] Resend provider error:', res.status, errBody.slice(0, 200));
          return {
            sent: false,
            status: 'failed',
            provider: 'resend',
            reason: 'Email delivery is currently unavailable. Please contact support for assistance.',
          };
        }

        const data = (await res.json()) as { id?: string };
        return {
          sent: true,
          status: 'sent',
          provider: 'resend',
          messageId: data.id,
        };
      } catch (err) {
        console.error('[Email] Delivery error:', err);
        return {
          sent: false,
          status: 'failed',
          provider: 'resend',
          reason: 'Email delivery is currently unavailable. Please contact support for assistance.',
        };
      }
    },
  };
}
