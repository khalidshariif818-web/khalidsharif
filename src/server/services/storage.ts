import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface IStorageService {
  uploadPublicCover(filename: string, bytes: Uint8Array, mimeType: string): Promise<string>;
  uploadPrivatePdf(filename: string, bytes: Uint8Array): Promise<string>;
  readPrivatePdf(storagePath: string): Promise<Uint8Array | null>;
}

export class SupabaseStorageService implements IStorageService {
  constructor(private readonly supabase: SupabaseClient) {}

  async uploadPublicCover(filename: string, bytes: Uint8Array, mimeType: string): Promise<string> {
    const safeName = path.basename(filename);
    const { error } = await this.supabase.storage.from('book-covers').upload(safeName, bytes, {
      contentType: mimeType,
      upsert: true,
    });

    if (error) throw new Error(`Cover upload failed: ${error.message}`);
    const { data } = this.supabase.storage.from('book-covers').getPublicUrl(safeName);
    return data.publicUrl;
  }

  async uploadPrivatePdf(filename: string, bytes: Uint8Array): Promise<string> {
    const safeName = path.basename(filename);
    const { error } = await this.supabase.storage.from('book-pdfs').upload(safeName, bytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

    if (error) throw new Error(`PDF upload failed: ${error.message}`);
    return safeName;
  }

  async readPrivatePdf(storagePath: string): Promise<Uint8Array | null> {
    const objectPath = storagePath.replace(/^\/+/, '');
    const { data, error } = await this.supabase.storage.from('book-pdfs').download(objectPath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
}
