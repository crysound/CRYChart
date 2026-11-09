import { ColorRGBA, SolidFill } from '../../src/index';
import type { OfficialMountContext } from './types';

export function createXY(context: OfficialMountContext, title: string, options?: { defaultAxisX?: { type: string } }) {
  const host = document.createElement('div'); host.className = 'official-main-chart'; context.host.append(host);
  const chart = context.engine.ChartXY({ ...options, container: host, theme: context.theme });
  chart.setPadding({ left: 6, right: 0, top: -18, bottom: 0 });
  const caption = document.createElement('div'); caption.className = 'plot-caption'; caption.textContent = title; chart.root.append(caption);
  chart.getDefaultAxisY().setTitleFillStyle(new SolidFill({ color: ColorRGBA(227, 230, 145) }));
  return { chart, caption, host };
}
