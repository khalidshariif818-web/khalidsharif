-- Khalid Sharif Digital Library - Full User Management Support
-- Migration 0006: Allow 'paused' account_status on profiles alongside 'active' and 'suspended'

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('active', 'paused', 'suspended'));
