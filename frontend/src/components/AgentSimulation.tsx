import { useEffect, useState } from 'react';
import type { Playback, Trajectory } from '../utils/playback';
import { fmtClock } from '../utils/format';

interface Props {
  playback: Playback;
  traj: Trajectory | null;
  total: number;
  running: boolean;
}

const SPEEDS = [1, 2, 4, 8, 16];

/** Playback bar for the recorded simulation (the backend computed every frame; this only animates). */
export default function AgentSimulation({ playback, traj, total, running }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(iv);
  }, []);
  const t = playback.timeRef.current;
  const dur = playback.duration;
  const evac = traj ? traj.evacuatedAt(t) : 0;
  const disabled = !traj || dur <= 0;

  return (
    <div className="playbar">
      <button className="icon-btn" disabled={disabled} onClick={() => (playback.playing ? playback.pause() : playback.play())} aria-label={playback.playing ? 'Pause' : 'Play'}>
        {playback.playing ? (
          <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2" width="3.5" height="12" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 2l10 6-10 6z" fill="currentColor" /></svg>
        )}
      </button>
      <button className="icon-btn" disabled={disabled} onClick={() => { playback.seek(0); playback.play(); }} aria-label="Restart">
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <input
        className="scrub"
        type="range"
        min={0}
        max={Math.max(dur, 0.1)}
        step={0.1}
        value={Math.min(t, dur)}
        disabled={disabled}
        onChange={(e) => { playback.pause(); playback.seek(parseFloat(e.target.value)); }}
        style={{ ['--fill' as string]: `${dur ? (t / dur) * 100 : 0}%` }}
      />
      <div className="playtime">
        <b>T+ {fmtClock(t)}</b>
        <span>/ {fmtClock(dur)}</span>
      </div>
      <div className="playcount">{running ? 'computing…' : traj ? `${evac}/${total} out` : `${total} agents`}</div>
      <div className="segmented small">
        {SPEEDS.map((s) => <button key={s} className={playback.speed === s ? 'on' : ''} onClick={() => playback.setSpeed(s)}>{s}×</button>)}
      </div>
    </div>
  );
}
