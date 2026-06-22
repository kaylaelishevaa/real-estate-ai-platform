import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParserPlayground } from './ParserPlayground';
import type { ParseResult } from '@/lib/types';

/** Let pending promises settle and React re-render. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 60));

// Mock the API client — tests never hit the network.
vi.mock('@/lib/api', () => ({ parseListing: vi.fn() }));
import { parseListing } from '@/lib/api';
const mockParse = vi.mocked(parseListing);

const WRITTEN: ParseResult = {
  status: 'written',
  record_status: 'active',
  tier: 'mid',
  confidence: { score: 1, reasons: [] },
  missing: [],
  reason: null,
  listing: {
    tipe_properti: 'Apartemen',
    nama_properti: 'Pakubuwono View',
    nama_properti_normalized: 'Pakubuwono View',
    tower_name: 'Redwood',
    unit: '12B',
    tipe_listing: 'Jual',
    channel: 'Direct',
    harga: 6_300_000_000,
    harga_jual: 6_300_000_000,
    harga_sewa: null,
    currency: 'IDR',
    rent_period: null,
    negotiable: false,
    kamar_tidur: '2',
    kamar_mandi: 1,
    luas_bangunan: 80,
    luas_tanah: null,
    lantai: null,
    kondisi: 'Furnished',
    owner_name: 'Sari',
    owner_phone: '6281299990001',
    sertifikat: null,
    notes: null,
  },
};

function typeBroadcast(value = 'Dijual apartemen Pakubuwono View ...') {
  fireEvent.change(screen.getByLabelText(/paste a whatsapp listing broadcast/i), {
    target: { value },
  });
}

describe('ParserPlayground', () => {
  it('renders the form with an empty state', () => {
    render(<ParserPlayground />);
    expect(screen.getByLabelText(/paste a whatsapp listing broadcast/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /parse listing/i })).toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('submits to the API and renders the parsed fields + model tier', async () => {
    mockParse.mockClear();
    mockParse.mockResolvedValue(WRITTEN);
    render(<ParserPlayground />);

    typeBroadcast();
    fireEvent.click(screen.getByRole('button', { name: /parse listing/i }));

    const badge = await screen.findByTestId('tier-badge');
    expect(badge).toHaveTextContent(/mid/i);
    expect(mockParse).toHaveBeenCalledOnce();
    expect(screen.getByTestId('parsed-fields')).toHaveTextContent('Pakubuwono View');
    expect(screen.getByTestId('parsed-fields')).toHaveTextContent('Rp 6.300.000.000');
    expect(screen.getByTestId('status-banner')).toHaveTextContent(/saved.*active/i);
  });

  it('saves an incomplete listing as a draft and lists the missing fields', async () => {
    mockParse.mockResolvedValue({
      status: 'written',
      record_status: 'draft',
      tier: 'cheap',
      confidence: { score: 0.4, reasons: ['no price'] },
      missing: ['harga', 'owner_name'],
      reason: null,
      listing: null,
    });
    render(<ParserPlayground />);
    typeBroadcast('Nama Properti : Casa Grande');
    fireEvent.click(screen.getByRole('button', { name: /parse listing/i }));

    const banner = await screen.findByTestId('status-banner');
    expect(banner).toHaveTextContent(/draft/i);
    const missing = await screen.findByTestId('missing-fields');
    expect(missing).toHaveTextContent(/harga/i);
    expect(missing).toHaveTextContent(/owner name/i);
  });

  it('renders an error state when the API call fails', async () => {
    mockParse.mockRejectedValue(new Error('Could not reach the API.'));
    render(<ParserPlayground />);
    typeBroadcast();
    fireEvent.click(screen.getByRole('button', { name: /parse listing/i }));

    // Settle the rejection + re-render, then assert (the component's catch
    // renders error-state). Avoids findBy/waitFor polling in jsdom.
    await flush();
    const el = screen.queryByTestId('error-state');
    expect(el).not.toBeNull();
    expect(el).toHaveTextContent(/could not reach the api/i);
  });
});
