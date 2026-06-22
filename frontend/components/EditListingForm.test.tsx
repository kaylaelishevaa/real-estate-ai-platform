import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditListingForm } from './EditListingForm';
import type { ListingFields } from '@/lib/types';

const LISTING: ListingFields = {
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
};

function setup(overrides: Partial<React.ComponentProps<typeof EditListingForm>> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<EditListingForm listing={LISTING} saving={false} error={null} onSave={onSave} onCancel={onCancel} {...overrides} />);
  return { onSave, onCancel };
}

describe('EditListingForm', () => {
  it('pre-fills the form from the listing', () => {
    setup();
    expect(screen.getByLabelText(/property/i)).toHaveValue('Pakubuwono View');
    expect(screen.getByLabelText(/unit/i)).toHaveValue('15A');
    expect(screen.getByLabelText(/sale price/i)).toHaveValue(4_500_000_000);
  });

  it('submits a payload with trimmed strings and numeric prices', () => {
    const { onSave } = setup();

    fireEvent.change(screen.getByLabelText(/owner phone/i), { target: { value: '  08123456789  ' } });
    fireEvent.change(screen.getByLabelText(/sale price/i), { target: { value: '7000000000' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledOnce();
    const payload = onSave.mock.calls[0][0];
    expect(payload.owner_phone).toBe('08123456789'); // trimmed
    expect(payload.harga_jual).toBe(7_000_000_000); // number, not string
    expect(payload.nama_properti).toBe('Pakubuwono View');
  });

  it('does not submit while saving', () => {
    const { onSave } = setup({ saving: true });
    fireEvent.click(screen.getByRole('button', { name: /saving/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onCancel from the Cancel button', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows an error banner when given an error', () => {
    setup({ error: 'Something failed' });
    expect(screen.getByTestId('edit-error')).toHaveTextContent('Something failed');
  });
});
