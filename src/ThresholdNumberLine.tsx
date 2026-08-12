import { useMemo, useState } from 'react';

import type { AndOrGraph, ChoiceBudget, FeatureMeta } from './types';
import { formatObjective } from './graphUtils';
import './thresholdNumberLine.css';

type ThresholdPoint = {
  splitId: number;
  feature: number;
  value: number;
  feasible: boolean;
  objective: number;
  excess: number;
};

type ThresholdNumberLineProps = {
  choices: ChoiceBudget[];
  graph: AndOrGraph;
  meta: FeatureMeta & Record<string, unknown>;
  thresholdDecimals: number;
  onApplySplit: (splitId: number) => void;
};

function rawThreshold(feature: number, meta: FeatureMeta): number | undefined {
  const raw = Array.isArray(meta.thresholds)
    ? meta.thresholds[feature]
    : meta.thresholds?.[String(feature)];

  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function stripZeros(x: string): string {
  return x.replace(/\.?0+$/, '');
}

function formatValue(value: number, decimals: number): string {
  return stripZeros(value.toFixed(decimals));
}

function lowerPoint(points: ThresholdPoint[], value: number): ThresholdPoint | undefined {
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);

    if (points[mid].value <= value) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best >= 0 ? points[best] : undefined;
}

export function ThresholdNumberLine({
  choices,
  graph,
  meta,
  thresholdDecimals,
  onApplySplit,
}: ThresholdNumberLineProps) {
  const points = useMemo(() => {
    const out: ThresholdPoint[] = [];

    for (const annotated of choices) {
      if (annotated.choice.kind !== 'split') continue;

      const split = annotated.choice.split;
      const value = rawThreshold(split.feature, meta);
      if (value === undefined) continue;

      out.push({
        splitId: split.id,
        feature: split.feature,
        value,
        feasible: annotated.feasible,
        objective: annotated.objective,
        excess: annotated.excess ?? 0,
      });
    }

    out.sort((a, b) => a.value - b.value || a.feature - b.feature);
    return out;
  }, [choices, meta]);

  const [manualValue, setManualValue] = useState('');
  const [selectedSplitId, setSelectedSplitId] = useState<number | null>(null);
  const [message, setMessage] = useState(
    'Click the number line or type a value below.',
  );

  if (points.length === 0) {
    return (
      <div className="threshold-line-empty">
        Numeric threshold values are not available for this feature.
      </div>
    );
  }

  const minValue = points[0].value;
  const maxValue = points[points.length - 1].value;
  const span = Math.max(maxValue - minValue, Number.EPSILON);
  const selected =
    selectedSplitId === null
      ? undefined
      : points.find((point) => point.splitId === selectedSplitId);

  const chooseValue = (value: number, applyImmediately: boolean) => {
    if (!Number.isFinite(value)) {
      setSelectedSplitId(null);
      setMessage('Enter a numeric threshold value.');
      return;
    }

    if (value < minValue || value > maxValue) {
      setSelectedSplitId(null);
      setMessage(
        `Enter a value from ${formatValue(minValue, thresholdDecimals)} to ${formatValue(
          maxValue,
          thresholdDecimals,
        )}.`,
      );
      return;
    }

    const point = lowerPoint(points, value);
    if (!point) {
      setSelectedSplitId(null);
      setMessage('There is no represented cut below that value.');
      return;
    }

    setSelectedSplitId(point.splitId);

    const shownCut = formatValue(point.value, thresholdDecimals);
    const tolerance = Math.max(1, Math.abs(point.value)) * 1e-12;
    const exact = Math.abs(value - point.value) <= tolerance;
    const snapText = exact
      ? `Cut ${shownCut}`
      : `Snaps down to cut ${shownCut}`;

    if (!point.feasible) {
      setMessage(
        `${snapText}, but that split is currently over budget by ${formatObjective(
          graph,
          point.excess,
        )}.`,
      );
      return;
    }

    setMessage(
      `${snapText} · objective ${formatObjective(graph, point.objective)} · available now.`,
    );

    if (applyImmediately) {
      onApplySplit(point.splitId);
    }
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const value = minValue + ratio * (maxValue - minValue);

    setManualValue(String(value));
    chooseValue(value, true);
  };

  return (
    <div className="threshold-number-line">
      <div className="threshold-line-legend" aria-label="Threshold availability legend">
        <span>
          <i className="threshold-legend-swatch feasible" />
          available now
        </span>
        <span>
          <i className="threshold-legend-swatch blocked" />
          over budget
        </span>
      </div>

      <button
        type="button"
        className="threshold-line-track"
        onClick={handleTrackClick}
        title="Click anywhere on the line to use the represented cut immediately below that value."
        aria-label={`Choose a threshold between ${formatValue(
          minValue,
          thresholdDecimals,
        )} and ${formatValue(maxValue, thresholdDecimals)}`}
      >
        <span className="threshold-line-base" />

        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          const left = (100 * (point.value - minValue)) / span;
          const right = (100 * (next.value - minValue)) / span;

          return (
            <span
              key={`segment-${point.splitId}`}
              className={`threshold-line-segment ${point.feasible ? 'feasible' : 'blocked'}`}
              style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
            />
          );
        })}

        {points.map((point) => {
          const left = (100 * (point.value - minValue)) / span;
          const isSelected = point.splitId === selectedSplitId;

          return (
            <span
              key={`tick-${point.splitId}`}
              className={`threshold-line-tick ${point.feasible ? 'feasible' : 'blocked'} ${
                isSelected ? 'selected' : ''
              }`}
              style={{ left: `${left}%` }}
              title={`${formatValue(point.value, thresholdDecimals)} · ${
                point.feasible
                  ? `objective ${formatObjective(graph, point.objective)}`
                  : `over budget by ${formatObjective(graph, point.excess)}`
              }`}
            />
          );
        })}
      </button>

      <div className="threshold-line-axis-labels">
        <span>{formatValue(minValue, thresholdDecimals)}</span>
        <span>{formatValue(maxValue, thresholdDecimals)}</span>
      </div>

      <div className="threshold-manual-row">
        <label>
          <span>Split value</span>
          <input
            type="number"
            step="any"
            value={manualValue}
            placeholder={formatValue((minValue + maxValue) / 2, thresholdDecimals)}
            onChange={(e) => {
              const raw = e.target.value;
              setManualValue(raw);

              if (raw.trim() === '') {
                setSelectedSplitId(null);
                setMessage('Click the number line or type a value below.');
                return;
              }

              chooseValue(Number(raw), false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && selected?.feasible) {
                onApplySplit(selected.splitId);
              }
            }}
          />
        </label>

        <button
          type="button"
          className="threshold-use-button"
          disabled={!selected?.feasible}
          onClick={() => {
            if (selected?.feasible) onApplySplit(selected.splitId);
          }}
        >
          {selected && !selected.feasible ? 'Over budget' : 'Use split'}
        </button>
      </div>

      <div className={`threshold-line-message ${selected && !selected.feasible ? 'blocked' : ''}`} aria-live="polite">
        {message}
      </div>

      <div className="threshold-line-help">
        Values between represented cutpoints snap to the cut immediately below them.
      </div>
    </div>
  );
}
