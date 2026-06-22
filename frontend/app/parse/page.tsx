import { ParserPlayground } from '@/components/ParserPlayground';

export const metadata = { title: 'Parser playground · Real Estate AI' };

export default function ParsePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Parser playground</h1>
        <p className="text-sm text-slate-600">
          Paste a WhatsApp listing broadcast (or pick a sample). The result shows each parsed field,
          the model tier that handled it, a confidence score, and either the missing fields or the
          rejection reason.
        </p>
      </header>
      <ParserPlayground />
    </div>
  );
}
