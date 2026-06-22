'use client';

/** Fabricated one-click sample broadcasts for the playground. */
export const SAMPLE_BROADCASTS: { label: string; text: string }[] = [
  {
    label: 'Messy free-form (escalates)',
    text:
      'Dijual cepat apt pakview tower Redwood unit 12B, 2BR 1KM LB 80, 6.3M nego furnished, owner Bu Sari 081299990001 direct',
  },
  {
    label: 'Clean template (cheap tier)',
    text: [
      'Jalur : Direct',
      'Nama Properti : South Hills',
      'Unit : 9C',
      'Tipe Properti : Apartemen',
      'Tipe Listing : Jual',
      'Harga Jual : 4.2M',
      'Kamar Tidur : 2',
      'Kamar Mandi : 1',
      'Luas Bangunan : 70',
      'Kondisi : Furnished',
      'Owner : Andi',
      'HP Owner : 08123456789',
    ].join('\n'),
  },
  {
    label: 'Cobroke (no owner needed)',
    text: [
      'Jalur : Cobroke',
      'Nama Properti : Green Valley Residence',
      'Tipe Properti : Rumah',
      'Tipe Listing : Jual',
      'Harga Jual : 5.5M',
      'Kamar Tidur : 3',
      'Kamar Mandi : 2',
      'Luas Bangunan : 150',
      'Luas Tanah : 200',
    ].join('\n'),
  },
  {
    label: 'Incomplete (asks for more)',
    text: 'Nama Properti : Casa Grande\nTipe Properti : Apartemen\nTipe Listing : Jual',
  },
];

export function SampleBroadcasts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SAMPLE_BROADCASTS.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onPick(s.text)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
