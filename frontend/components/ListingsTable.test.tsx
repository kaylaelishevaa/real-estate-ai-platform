import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ListingsTable } from './ListingsTable';
import type { ListingSummary } from '@/lib/types';

const ROWS: ListingSummary[] = [
  {
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
  },
  {
    id: 'greenvalleyresidence',
    status: 'draft',
    missing: ['harga'],
    nama_properti: 'Green Valley Residence',
    tipe_properti: 'Rumah',
    tipe_listing: 'Jual',
    channel: 'Cobroke',
    unit: null,
    harga: 5_500_000_000,
    currency: 'IDR',
    rent_period: null,
    kondisi: null,
    revision: 2,
  },
];

describe('ListingsTable', () => {
  it('renders a row per seeded listing', () => {
    render(<ListingsTable rows={ROWS} />);
    expect(screen.getAllByTestId('listing-row')).toHaveLength(2);
    expect(screen.getByText('Pakubuwono View')).toBeInTheDocument();
    expect(screen.getByText('Green Valley Residence')).toBeInTheDocument();
    expect(screen.getByText('Rp 4.500.000.000')).toBeInTheDocument();
    // status column
    const badges = screen.getAllByTestId('status-badge');
    expect(badges).toHaveLength(2);
    expect(badges.map((b) => b.textContent)).toEqual(['active', 'draft']);
  });

  it('shows an empty state when there are no rows', () => {
    render(<ListingsTable rows={[]} />);
    expect(screen.getByText(/no listings yet/i)).toBeInTheDocument();
  });

  it('delete confirm flow removes the row', async () => {
    function Wrapper() {
      const [rows, setRows] = useState(ROWS);
      return <ListingsTable rows={rows} onDelete={(id) => setRows((r) => r.filter((x) => x.id !== id))} />;
    }
    render(<Wrapper />);
    expect(screen.getAllByTestId('listing-row')).toHaveLength(2);

    fireEvent.click(screen.getAllByTestId('delete-button')[0]);
    expect(screen.getByTestId('confirm-delete')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-delete-yes'));

    await waitFor(() => expect(screen.getAllByTestId('listing-row')).toHaveLength(1));
    expect(screen.queryByText('Pakubuwono View')).not.toBeInTheDocument();
  });
});
