import { filterInbound } from './message-whitelist';

describe('filterInbound — whitelist fails closed', () => {
  it('accepts a text message with a body', () => {
    const r = filterInbound({ type: 'text', from: '628', text: 'Jual apartemen' });
    expect(r.accepted).toBe(true);
  });

  it('accepts an image with a media id', () => {
    const r = filterInbound({ type: 'image', from: '628', mediaId: 'abc' });
    expect(r.accepted).toBe(true);
  });

  // The phantom-record fix: every non-listing type must be rejected, not ignored.
  it.each(['audio', 'video', 'sticker', 'location', 'contacts', 'reaction', 'system', 'order'])(
    'rejects unsupported type: %s',
    (type) => {
      const r = filterInbound({ type, from: '628' });
      expect(r.accepted).toBe(false);
      if (!r.accepted) expect(r.reason).toMatch(/unsupported/);
    },
  );

  it('rejects malformed and empty payloads', () => {
    expect(filterInbound(null).accepted).toBe(false);
    expect(filterInbound({}).accepted).toBe(false);
    expect(filterInbound({ type: '' }).accepted).toBe(false);
    expect(filterInbound({ type: 'text', from: '628', text: '   ' }).accepted).toBe(false);
    expect(filterInbound({ type: 'image', from: '628' }).accepted).toBe(false);
  });
});
