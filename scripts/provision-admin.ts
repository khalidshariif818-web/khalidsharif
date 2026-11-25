import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadServerConfig } from '../src/server/config.ts';
import type { ILibraryRepository } from '../src/server/db/interface.ts';
import { SupabaseLibraryRepository } from '../src/server/db/supabaseRepository.ts';
import { ensureSupabaseSeedData } from '../src/server/db/supabaseSeed.ts';
import { hashPassword } from '../src/server/security.ts';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const email = getArg('--email');
  const password = getArg('--password');
  const fullName = getArg('--name') || 'Library Administrator';

  if (!email || !password || password.length < 10) {
    console.error('Usage: npm run provision-admin -- --email admin@example.com --password <min-10-chars> [--name "Name"]');
    process.exit(1);
  }

  const config = loadServerConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase is required. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await ensureSupabaseSeedData(supabase);
  const repo: ILibraryRepository = new SupabaseLibraryRepository(supabase);
  console.log('Target database: Supabase PostgreSQL');

  const existing = await repo.findAuthCredentialsByEmail(email);
  let userId: string;
  if (existing) {
    userId = existing.id;
    await repo.updatePasswordHash(userId, hashPassword(password));
  } else {
    const created = await repo.createCustomerUser({
      email,
      passwordHash: hashPassword(password),
      fullName,
      preferredLanguage: 'so',
    });
    userId = created.id;
  }

  await repo.grantAdminRole(userId, null, 'super_admin');
  await repo.logAdminAction({
    actorUserId: userId,
    action: 'cli_provision_admin',
    entityType: 'user_roles',
    entityId: userId,
  });

  console.log(`Administrator provisioned for ${email} (userId: ${userId}).`);
}

main().catch((err) => {
  console.error('Failed to provision administrator:', err);
  process.exit(1);
});
