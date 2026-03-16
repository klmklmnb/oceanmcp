import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Column, Bar, Line, Area, Pie, Scatter, Radar } from '@ant-design/charts';

export interface ChartProps {
  data: Record<string, any>[];
  xField: string;
  yField: string;
  title?: string;
}

function ExpandIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 1024 1024" fill="currentColor">
      <path d="M290 236.4l43.9-43.9a8.01 8.01 0 0 0-4.7-13.6L169 160c-5.1-.6-9.5 3.7-8.9 8.9L179 329.1c.8 6.6 8.9 9.4 13.6 4.7l43.7-43.7L370 423.7c3.1 3.1 8.2 3.1 11.3 0l42.4-42.3c3.1-3.1 3.1-8.2 0-11.3L290 236.4zm352.7 187.3c3.1 3.1 8.2 3.1 11.3 0l133.7-133.6 43.7 43.7a8.01 8.01 0 0 0 13.6-4.7L863.7 169c.6-5.1-3.7-9.5-8.9-8.9L694.8 179c-6.6.8-9.4 8.9-4.7 13.6l43.9 43.9L600.3 370a8.03 8.03 0 0 0 0 11.3l42.4 42.4zM845 694.9c-.8-6.6-8.9-9.4-13.6-4.7l-43.7 43.7L654 600.3a8.03 8.03 0 0 0-11.3 0l-42.4 42.3a8.03 8.03 0 0 0 0 11.3L734 787.6l-43.9 43.9a8.01 8.01 0 0 0 4.7 13.6L855 864c5.1.6 9.5-3.7 8.9-8.9L845 694.9zm-463.7-94.6a8.03 8.03 0 0 0-11.3 0L236.3 734l-43.7-43.7a8.01 8.01 0 0 0-13.6 4.7L160.1 855c-.6 5.1 3.7 9.5 8.9 8.9L329.2 845c6.6-.8 9.4-8.9 4.7-13.6L290 787.6 423.7 654c3.1-3.1 3.1-8.2 0-11.3l-42.4-42.4z" />
    </svg>
  );
}

function ChartModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
      />
      <div
        style={{
          position: 'relative',
          background: '#fff',
          borderRadius: 8,
          width: 900,
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: '20px 24px',
          boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 500 }}>{title}</span>
          <span
            style={{ cursor: 'pointer', fontSize: 20, lineHeight: 1, color: '#999' }}
            onClick={onClose}
          >
            &times;
          </span>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const expandBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  cursor: 'pointer',
  zIndex: 1,
  padding: 4,
  borderRadius: 4,
  fontSize: 16,
  color: '#666',
  background: 'rgba(255,255,255,0.85)',
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function createChartView(
  ChartComponent: React.ComponentType<any>,
  getSpecificProps: (props: ChartProps) => Record<string, any>,
): React.FC<ChartProps> {
  const View: React.FC<ChartProps> = (props) => {
    const { data, xField, yField, title } = props;
    const [expanded, setExpanded] = useState(false);
    const commonProps = {
      data,
      title: { text: title },
      tooltip: (d: Record<string, any>) => ({ name: d[xField], value: d[yField] }),
      paddingTop: 40,
      ...getSpecificProps(props),
    };

    return (
      <div style={{ position: 'relative', background: '#fff', borderRadius: 8, padding: 12 }}>
        <ChartComponent {...commonProps} height={300} />
        <div style={expandBtnStyle} onClick={() => setExpanded(true)}>
          <ExpandIcon />
        </div>
        <ChartModal open={expanded} onClose={() => setExpanded(false)} title={title}>
          <ChartComponent {...commonProps} height={600} autoFit />
        </ChartModal>
      </div>
    );
  };
  return View;
}

export const BarChartView = createChartView(Column, ({ xField, yField }) => ({
  xField,
  yField,
  columnStyle: { radius: [4, 4, 0, 0] },
  color: '#4F86F7',
}));

export const HorizontalBarView = createChartView(Bar, ({ xField, yField }) => ({
  xField: yField,
  yField: xField,
  color: '#4F86F7',
}));

export const LineChartView = createChartView(Line, ({ xField, yField }) => ({
  xField,
  yField,
  smooth: true,
  point: { size: 3 },
  color: '#4F86F7',
}));

export const AreaChartView = createChartView(Area, ({ xField, yField }) => ({
  xField,
  yField,
  style: { fillOpacity: 0.15 },
}));

export const PieChartView = createChartView(Pie, ({ xField, yField }) => ({
  angleField: yField,
  colorField: xField,
  label: { text: xField, position: 'outside' },
  legend: {
    color: {
      position: 'top',
    },
  },
}));

export const ScatterChartView = createChartView(Scatter, ({ xField, yField }) => ({
  xField,
  yField,
  color: '#4F86F7',
  size: 4,
}));

export const RadarChartView = createChartView(Radar, ({ xField, yField }) => ({
  xField,
  yField,
  area: { style: { fillOpacity: 0.15 } },
}));

export const CHART_MAP: Record<string, React.FC<ChartProps>> = {
  bar: BarChartView,
  horizontal_bar: HorizontalBarView,
  line: LineChartView,
  area: AreaChartView,
  pie: PieChartView,
  scatter: ScatterChartView,
  radar: RadarChartView,
};

export const CHART_ENUM: Record<string, string> = {
  bar: '柱状图 — 适合分类对比（竖向）',
  horizontal_bar: '条形图 — 适合分类对比（横向，类别名较长时推荐）',
  line: '折线图 — 适合时间趋势',
  area: '面积图 — 适合趋势+量级展示',
  pie: '饼图 — 适合占比/分布分析（数据项≤8个）',
  scatter: '散点图 — 适合两个数值维度的相关性分析',
  radar: '雷达图 — 适合多维度能力对比',
};
