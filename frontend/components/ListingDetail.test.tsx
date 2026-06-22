import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListingDetail } from './ListingDetail';
import type { ListingDetail as Detail } from '@/lib/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ updateListing: vi.fn(), deleteListing: vi.fn() }));
import { updateListing } from '@/lib/api';
const mockUpdate = vi.mocked(updateListing);

const flush = () => new Promise((r) => setTimeout(r, 50));

const DETAIL: Detail = {
  id: 'pakubuwonoview:15a',
  status: 'active',
  missing: [],
  nama_properti: 'Pakubuwono View',
  tipe_properti: 'Apartemen',
  tipe_listing: 'Jual',
  channel: 'Direct',
  unit: '15A',
  harga: 4_500_000_000,
  currency: 'IDR',
  rent_period: null,
  kondisi: 'Furnished',
  revision: 1,
  listing: {
    tipe_properti: 'Apartemen',
    nama_properti: 'Pakubuwono View',
    nama_properti_normalized: 'Pakubuwono View',
    tower_name: null,
    unit: '15A',
    tipe_listing: 'Jual',
    channel: 'Direct',
    harga: 4_500_000_000,
    harga_jual: 4_500_000_000,
    harga_sewa: null,
    currency: 'IDR',
    rent_period: null,
    negotiable: false,
    kamar_tidur: '2',
    kamar_mandi: 1,
    luas_bangunan: 76,
    luas_tanah: null,
    lantai: null,
    kondisi: 'Furnished',
    owner_name: 'Budi',
    owner_phone: '628123456789',
    sertifikat: null,
    notes: null,
  },
};

describe('ListingDetail', () => {
  it('renders the parsed fields in view mode', () => {
    render(<ListingDetail detail={DETAIL} mutate={vi.fn()} />);
    expect(screen.getByTestId('parsed-fields')).toHaveTextContent('Pakubuwono View');
    expect(screen.getByTestId('edit-button')).toBeInTheDocument();
  });

  it('edits → saves: calls the API and renders the updated result', async () => {
    const updated: Detail = {
      ...DETAIL,
      harga: 7_000_000_000,
      listing: { ...DETAIL.listing, harga_jual: 7_000_000_000, harga: 7_000_000_000 },
    };
    mockUpdate.mockResolvedValue(updated);
    const mutate = vi.fn();
    const { rerender } = render(<ListingDetail detail={DETAIL} mutate={mutate} />);

    fireEvent.click(screen.getByTestId('edit-button'));
    expect(screen.getByTestId('edit-form')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/sale price/i), { target: { value: '7000000000' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await flush();

    expect(mockUpdate).toHaveBeenCalledWith(
      'pakubuwonoview:15a',
      expect.objectContaining({ harga_jual: 7_000_000_000 }),
    );
    expect(mutate).toHaveBeenCalledWith(updated, { revalidate: false });

    // SWR feeds the updated detail back as the prop → the view shows the new price.
    rerender(<ListingDetail detail={updated} mutate={mutate} />);
    expect(screen.getByTestId('parsed-fields')).toHaveTextContent('Rp 7.000.000.000');
  });
});
