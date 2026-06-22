import { OrderedListingWriter, WriteOrderError } from './write-order';
import { InMemoryListingStore } from '../store/in-memory-listing-store';
import { InMemoryChatHistoryStore } from '../store/in-memory-chat-history';
import { normalizeListing } from '../parse/normalize-listing';
import { listingKey } from '../store/listing-key';

const listing = normalizeListing({
  nama_properti: 'pakview',
  unit: '15A',
  harga_jual: '4.5M',
  tipe_listing: 'Jual',
});

describe('write-order invariant: history before record', () => {
  let history: InMemoryChatHistoryStore;
  let listings: InMemoryListingStore;
  let writer: OrderedListingWriter;

  beforeEach(() => {
    history = new InMemoryChatHistoryStore();
    listings = new InMemoryListingStore();
    writer = new OrderedListingWriter(history, listings);
  });

  it('persists chat history, then the record', () => {
    const out = writer.commit(listing, [{ from: '628', text: 'Jual pakview 15A 4.5M' }], 'active');
    const key = listingKey(listing);

    expect(history.has(key)).toBe(true);
    expect(out.created).toBe(true);
    expect(listings.get(key)).toBeDefined();
  });

  it('refuses to create an orphan record when there is no history', () => {
    expect(() => writer.commit(listing, [], 'active')).toThrow(WriteOrderError);
    // Nothing was written to the record store.
    expect(listings.size()).toBe(0);
  });
});
