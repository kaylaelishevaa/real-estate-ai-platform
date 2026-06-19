/**
 * Idempotent-republish invariant: re-publishing the same listing is a no-op
 * (an in-place update), never a new row. The identity is the content-derived
 * listing key, so the same broadcast — or an alias-equivalent one — collapses
 * onto one record.
 */

import { OrderedListingWriter } from './write-order';
import { InMemoryListingStore } from '../store/in-memory-listing-store';
import { InMemoryChatHistoryStore } from '../store/in-memory-chat-history';
import { normalizeListing } from '../parse/normalize-listing';

const history = () => new InMemoryChatHistoryStore();

describe('idempotent republish', () => {
  it('does not double-create when the same listing is published twice', () => {
    const listings = new InMemoryListingStore();
    const writer = new OrderedListingWriter(history(), listings);
    const listing = normalizeListing({ nama_properti: 'pakview', unit: '15A', harga_jual: '4.5M' });
    const msg = [{ from: '628', text: 'Jual pakview 15A 4.5M' }];

    const first = writer.commit(listing, msg);
    const second = writer.commit(listing, msg);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false); // republish, not a new row
    expect(second.record.revision).toBe(2);
    expect(listings.size()).toBe(1);
  });

  it('treats an alias-equivalent name as the same listing', () => {
    const listings = new InMemoryListingStore();
    const writer = new OrderedListingWriter(history(), listings);
    const a = normalizeListing({ nama_properti: 'pakview', unit: '15A', harga_jual: '4.5M' });
    const b = normalizeListing({ nama_properti: 'Pakubuwono View', unit: '15A', harga_jual: '4.5M' });
    const msg = [{ from: '628', text: 'x' }];

    writer.commit(a, msg);
    const second = writer.commit(b, msg);

    expect(second.created).toBe(false);
    expect(listings.size()).toBe(1);
  });

  it('keeps distinct units as distinct listings', () => {
    const listings = new InMemoryListingStore();
    const writer = new OrderedListingWriter(history(), listings);
    const msg = [{ from: '628', text: 'x' }];

    writer.commit(normalizeListing({ nama_properti: 'pakview', unit: '15A', harga_jual: '4.5M' }), msg);
    writer.commit(normalizeListing({ nama_properti: 'pakview', unit: '16B', harga_jual: '4.5M' }), msg);

    expect(listings.size()).toBe(2);
  });
});
