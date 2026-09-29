import { useEffect, useRef, useState } from 'react';
import type { CopilotMessage } from '../types';

interface Props {
  messages: CopilotMessage[];
  busy: boolean;
  onSend: (text: string) => void;
}

const SUGGESTIONS = [
  'Increase occupancy by 20%',
  'Make the corridor wider',
  'What happens if the east exit is blocked?',
  'Run the evacuation',
];

export default function Copilot({ messages, busy, onSend }: Props) {
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages]);
  const send = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    onSend(v);
    setText('');
  };
  return (
    <section className="copilot">
      <div className="panel-head">
        <h3>Wayout Copilot</h3>
        <span className="badge" title="Deterministic keyword parsing - not a language model. Will be replaced by NVIDIA Nemotron.">local rule-based · not an LLM</span>
      </div>
      <div className="cp-log" ref={log}>
        {messages.length === 0 && <div className="cp-empty">Ask for a design change or an analysis, e.g. “What happens if the east exit is blocked?”</div>}
        {messages.map((m) => (
          <div key={m.id} className={`cp-msg ${m.role}`}>{m.text}</div>
        ))}
      </div>
      <div className="cp-suggest">
        {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>)}
      </div>
      <div className="cp-input">
        <input value={text} placeholder="Type a command…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(text)} />
        <button className="btn primary small" onClick={() => send(text)} disabled={busy || !text.trim()}>Send</button>
      </div>
    </section>
  );
}
