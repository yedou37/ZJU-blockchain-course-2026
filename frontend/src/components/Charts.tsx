import { useId } from "react";
import { fmtNum } from "../lib/chain";

export type Series = { label: string; color: string; points: number[] };

const WIDTH = 720;

/** 多序列折线图（带面积渐变、网格与坐标轴），纯 SVG，不依赖图表库 */
export function LineChart(props: {
  series: Series[];
  height?: number;
  valueDigits?: number;
  emptyHint?: string;
}) {
  const height = props.height ?? 240;
  const digits = props.valueDigits ?? 4;
  const gradientId = `grad-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const series = props.series.filter((item) => item.points.length > 0);
  const values = series.flatMap((item) => item.points);
  if (values.length === 0) {
    return <div className="empty">{props.emptyHint ?? "还没有数据"}</div>;
  }

  const padL = 52;
  const padR = 18;
  const padT = 18;
  const padB = 28;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawSpan = rawMax - rawMin || Math.abs(rawMax) * 0.02 || 1;
  const yMin = rawMin - rawSpan * 0.15;
  const yMax = rawMax + rawSpan * 0.15;
  const count = Math.max(...series.map((item) => item.points.length), 2);

  const x = (index: number) => padL + (index / (count - 1)) * (WIDTH - padL - padR);
  const y = (value: number) => padT + (1 - (value - yMin) / (yMax - yMin)) * (height - padT - padB);
  const baseline = height - padB;

  const ticks = [0, 1, 2, 3].map((step) => yMax - (step * (yMax - yMin)) / 3);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="走势图">
        <defs>
          {series.map((item, index) => (
            <linearGradient key={item.label} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((tick, index) => (
          <g key={tick}>
            <line
              x1={padL}
              y1={y(tick)}
              x2={WIDTH - padR}
              y2={y(tick)}
              stroke={index === ticks.length - 1 ? "#dfe3ea" : "#eef2f8"}
              strokeDasharray={index === ticks.length - 1 ? undefined : "4 4"}
            />
            <text x={padL - 8} y={y(tick) + 3.5} textAnchor="end" className="chart-label">
              {fmtNum(tick, digits)}
            </text>
          </g>
        ))}

        {series.map((item, index) => {
          const line = item.points
            .map((value, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(value).toFixed(1)}`)
            .join(" ");
          const area = `${line} L${x(item.points.length - 1).toFixed(1)},${baseline} L${padL},${baseline} Z`;
          return (
            <g key={item.label}>
              <path d={area} fill={`url(#${gradientId}-${index})`} />
              <path d={line} fill="none" stroke={item.color} strokeWidth={2.2} strokeLinejoin="round" />
            </g>
          );
        })}

        {series.map((item) =>
          item.points.length <= 40
            ? item.points.map((value, index) => (
                <circle key={`${item.label}-${index}`} cx={x(index)} cy={y(value)} r={2.6} fill={item.color} />
              ))
            : null
        )}

        <text x={padL} y={height - 8} className="chart-label">
          最早
        </text>
        <text x={WIDTH - padR} y={height - 8} textAnchor="end" className="chart-label">
          最新
        </text>
      </svg>
      <div className="legend">
        {series.map((item) => (
          <span key={item.label}>
            <i style={{ background: item.color }} /> {item.label}
            <b>{fmtNum(item.points[item.points.length - 1], digits)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 前后对比柱状图，用于套利前后的价格 */
export function BarCompare(props: {
  groups: { label: string; before: number; after: number }[];
  digits?: number;
}) {
  const digits = props.digits ?? 4;
  const max = Math.max(...props.groups.flatMap((group) => [group.before, group.after]), 0.000001);
  const width = 720;
  const height = 200;
  const padB = 34;
  const padT = 42;
  const groupWidth = width / props.groups.length;
  const barWidth = 46;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="套利前后价格对比">
        <line x1={0} y1={height - padB} x2={width} y2={height - padB} stroke="#dfe3ea" />
        {props.groups.map((group, index) => {
          const center = groupWidth * index + groupWidth / 2;
          const beforeHeight = ((height - padT - padB) * group.before) / max;
          const afterHeight = ((height - padT - padB) * group.after) / max;
          return (
            <g key={group.label}>
              <rect
                x={center - barWidth - 6}
                y={height - padB - beforeHeight}
                width={barWidth}
                height={Math.max(beforeHeight, 2)}
                rx={6}
                fill="#c9d6ea"
              />
              <rect
                x={center + 6}
                y={height - padB - afterHeight}
                width={barWidth}
                height={Math.max(afterHeight, 2)}
                rx={6}
                fill="#2f6bff"
              />
              <text x={center - barWidth / 2 - 6} y={height - padB - beforeHeight - 7} textAnchor="middle" className="chart-label">
                {fmtNum(group.before, digits)}
              </text>
              <text x={center + barWidth / 2 + 6} y={height - padB - afterHeight - 7} textAnchor="middle" className="chart-label">
                {fmtNum(group.after, digits)}
              </text>
              <text x={center} y={height - 10} textAnchor="middle" className="chart-label">
                {group.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span>
          <i style={{ background: "#c9d6ea" }} /> 套利前
        </span>
        <span>
          <i style={{ background: "#2f6bff" }} /> 套利后
        </span>
      </div>
    </div>
  );
}

/** 价差刻度条：把 bps 映射成一条进度条 */
export function GapMeter(props: { bps: number; max?: number; threshold?: number }) {
  const max = props.max ?? 2500;
  const threshold = props.threshold ?? 60;
  const ratio = Math.max(0, Math.min(props.bps / max, 1));
  const tone = props.bps > threshold ? "hot" : "calm";
  return (
    <div className="meter">
      <div className="meter-track">
        <div className={`meter-fill ${tone}`} style={{ width: `${props.bps > 0 ? Math.max(ratio * 100, 1.2) : 0}%` }} />
        <div className="meter-mark" style={{ left: `${(threshold / max) * 100}%` }} title={`套利阈值 ${threshold} bps`} />
      </div>
      <div className="meter-labels">
        <span>0</span>
        <span className="muted small">
          {props.bps > threshold ? "存在套利空间" : "低于手续费成本，套利无利可图"} · 成本线 ≈ {threshold} bps
        </span>
        <span>{fmtNum(max, 0)}</span>
      </div>
    </div>
  );
}
