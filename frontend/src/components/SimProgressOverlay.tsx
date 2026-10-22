import type { SimProgress } from '../types';
import { fmtClock } from '../utils/format';

interface SimProgressOverlayProps {
  progress: SimProgress | null;
  nFloors: number;
  totalOccupants: number;
  elapsed: number;
  /** AI estimate for this design, shown as something to compare against while waiting. */
  prediction: { seconds: number; errorS: number } | null;
}

const floorName = (i: number) => (i === 0 ? 'Ground' : `Floor ${i}`);

// Slightly different walking paces so the little crowd looks natural, not marching.
const WALKERS = [4.6, 4.2, 4.9, 4.4, 4.7, 4.3];

/** Decorative loop: people walking to a lit EXIT. Purely illustrative - the live numbers
 * below are the real progress. With reduced motion it freezes into a still picture. */
function EvacuationAnimation() {
  return (
    <svg className="wy-walk" viewBox="0 0 240 60" aria-hidden="true" focusable="false">
      <line className="wy-walk-floor" x1="4" y1="54" x2="236" y2="54" />
      <rect className="wy-walk-door" x="208" y="20" width="20" height="34" rx="1" />
      <rect className="wy-walk-sign" x="206" y="9" width="24" height="8" rx="1.5" />
      <text className="wy-walk-sign-text" x="218" y="15">EXIT</text>
      {WALKERS.map((pace, i) => (
        <g
          key={i}
          className="wy-walker"
          style={{ animationDuration: `${pace}s`, animationDelay: `${-i * 0.75}s` }}
        >
          <g className="wy-walker-bob" style={{ animationDelay: `${-i * 0.13}s` }}>
            <circle cx="0" cy="37" r="3" />
            <rect x="-2.6" y="41.5" width="5.2" height="11" rx="2.6" />
          </g>
        </g>
      ))}
    </svg>
  );
}

/** Waiting screen for a running simulation. Every number shown comes from the live run
 * (GET /api/simulate/progress) - nothing is a timed animation pretending to be progress. */
export default function SimProgressOverlay({ progress, nFloors, totalOccupants, elapsed, prediction }: SimProgressOverlayProps) {
  const live = progress && progress.stage !== 'none' ? progress : null;
  const packaging = live?.stage === 'packaging';
  const n = live?.n_floors ?? nFloors;
  const floor = live?.floor ?? n - 1;
  const done = live?.floors_done ?? 0;
  const out = live?.evacuated ?? 0;
  const total = Math.max(1, live?.floor_total ?? 1);
  const fraction = packaging ? 1 : live ? Math.min(1, (done + out / total) / n) : 0;

  let title = 'Preparing the building…';
  let line = `Building the floor plan${n > 1 ? 's' : ''} and placing ${totalOccupants} people.`;
  let explain = 'Each person gets their own walking speed and a short reaction delay before they start moving.';
  if (packaging) {
    title = 'Preparing the 3D replay…';
    line = 'The evacuation is finished. Packaging every person’s path for playback.';
    explain = 'Bigger buildings take a few extra seconds here: every position is saved for the replay.';
  } else if (live) {
    title = n === 1 ? 'Running the evacuation' : floor === 0 ? 'Simulating the ground floor' : `Simulating floor ${floor}`;
    if (floor > 0) {
      line = `${out} of ${live.floor_total} people have reached this floor’s stairs.`;
      explain = 'Upper floors run first. The moment each person reaches a stairwell becomes their arrival time on the floor below.';
    } else {
      line = `${out} of ${live.floor_total} people are out of the building.`;
      explain = n > 1
        ? 'People from upstairs are now arriving down the stairs. The ground floor’s exits are where everyone actually leaves.'
        : 'Each person heads for an exit, avoids walls and other people, and switches exits only when another is clearly quicker.';
    }
  }

  return (
    <div className="busy" role="status" aria-live="polite">
      <div className="busy-box wy-progress-box">
        <EvacuationAnimation />
        <div className="busy-title">{title}</div>

        {n > 1 && (
          <ol className="wy-floor-steps" aria-label="Floors, simulated from the top down">
            {Array.from({ length: n }, (_, k) => n - 1 - k).map((i) => {
              const state = packaging || (live && i > floor) ? 'done' : live && i === floor ? 'active' : 'todo';
              return (
                <li key={i} className={`wy-floor-step ${state}`}>
                  {state === 'done' ? '✓ ' : ''}{floorName(i)}
                </li>
              );
            })}
          </ol>
        )}

        <div className="busy-sub">{line}</div>

        {live && !packaging ? (
          <div className="wy-progress" aria-label={`${Math.round(fraction * 100)}% of the simulation done`}>
            <span style={{ width: `${Math.max(2, fraction * 100)}%` }} />
          </div>
        ) : (
          <div className="indeterminate" />
        )}

        <div className="wy-progress-stats">
          {live?.sim_time != null && !packaging && <span>Simulated time {fmtClock(live.sim_time)}</span>}
          <span>Elapsed {fmtClock(elapsed)}</span>
        </div>

        <p className="wy-progress-explain">{explain}</p>

        {prediction && (
          <div className="wy-progress-ai">
            AI predicted clearance <b>{fmtClock(prediction.seconds)}</b> (typ. ±{prediction.errorS.toFixed(0)}s).
            The simulation will confirm or correct it.
          </div>
        )}
      </div>
    </div>
  );
}
