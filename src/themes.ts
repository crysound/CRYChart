import {Color, ColorHEX, FontSettings, SolidFill, SolidLine, Themes, TriangulatedPoints3D, emptyFill, type FillStyle, type LineStyle, type Theme} from './core/styles.js';

export interface CustomThemeOptions {
  isDark?: boolean; effects?: boolean; gradients?: boolean; dataColors?: readonly Color[];
  backgroundColor?: Color | FillStyle; textColor?: Color; gridLineColor?: Color; axisColor?: Color;
  uiBackgroundColor?: Color; uiBorderColor?: Color; dashboardSplitterColor?: Color;
  fontFamily?: string;
  lineSeriesStrokeStyle?:LineStyle|((index:number)=>LineStyle);
  pointSeriesFillStyle?:Theme['pointSeriesFillStyle'];
  pointSeriesStrokeStyle?:Theme['pointSeriesStrokeStyle'];
  lineSeries3DStrokeStyle?:Theme['lineSeries3DStrokeStyle'];
  pointSeries3DPointStyle?:Theme['pointSeries3DPointStyle'];
  fontSize?: number | Partial<{chartTitle: number; axisTitle: number; legendTitle: number; other: number}>;
  [key: string]: unknown;
}
/** Theme construction maps user palette choices to concrete drawing styles. */
export function makeCustomTheme(options: CustomThemeOptions = {}): Theme {
  const base = options.isDark ? Themes.dark : Themes.light;
  const text = options.textColor ?? (base.textColor as Color);
  // Separate ESM/CJS/theme bundles have distinct Color constructors. FillStyle's
  // public discriminator preserves fill objects without relying on that identity.
  const inputBackground = options.backgroundColor;
  const background = inputBackground == null ? base.backgroundFillStyle
    : 'kind' in inputBackground ? inputBackground : new SolidFill({color: inputBackground});
  const grid = options.gridLineColor ?? ColorHEX(options.isDark ? '#314353' : '#dce3e8');
  const axis = options.axisColor ?? text;
  const sizes = typeof options.fontSize === 'number' ? {chartTitle: options.fontSize, axisTitle: options.fontSize, legendTitle: options.fontSize, other: options.fontSize} : options.fontSize ?? {};
  const family = options.fontFamily ?? 'Arial';
  const textFill = new SolidFill({color: text});
  const chartTitleFont=new FontSettings({size:sizes.chartTitle??16,family});
  const axisTitleFont=new FontSettings({size:sizes.axisTitle??12,family});
  const dataColors=options.dataColors?[...options.dataColors]:undefined;
  const seriesStyles:Pick<Theme,'pointSeriesFillStyle'|'pointSeriesStrokeStyle'>&{lineSeriesStrokeStyle?:CustomThemeOptions['lineSeriesStrokeStyle']}={};
  if(dataColors?.length){
    const colorAt=(index:number)=>dataColors[((Math.trunc(index)%dataColors.length)+dataColors.length)%dataColors.length]!;
    const fillAt=(index:number)=>new SolidFill({color:colorAt(index)});
    seriesStyles.lineSeriesStrokeStyle=options.lineSeriesStrokeStyle??(index=>new SolidLine({thickness:2,fillStyle:fillAt(index)}));
    seriesStyles.pointSeriesFillStyle=options.pointSeriesFillStyle??fillAt;
    seriesStyles.pointSeriesStrokeStyle=options.pointSeriesStrokeStyle??new SolidLine({thickness:1,fillStyle:new SolidFill({color:ColorHEX('#ffffff')})});
  }
  // Production3D palettes use their own public fields. Keep the factory's
  // ordinary palette fallback when a custom palette is absent or empty.
  const colors3D=dataColors?.length?dataColors:base.dataColors;
  const fill3D=(index:number)=>new SolidFill({color:colors3D[((Math.trunc(index)%colors3D.length)+colors3D.length)%colors3D.length]!});
  const styles3D:Pick<Theme,'lineSeries3DStrokeStyle'|'pointSeries3DPointStyle'>={
    lineSeries3DStrokeStyle:options.lineSeries3DStrokeStyle??base.lineSeries3DStrokeStyle??(index=>new SolidLine({thickness:2,fillStyle:fill3D(index)})),
    pointSeries3DPointStyle:options.pointSeries3DPointStyle??base.pointSeries3DPointStyle??(index=>new TriangulatedPoints3D({size:10,fillStyle:fill3D(index)})),
  };
  return {
    ...base, name: 'custom', ...options, backgroundColor: background.getColor?.() ?? ColorHEX('#00000000'), textColor: text,
    ...seriesStyles, ...styles3D,
    backgroundFillStyle: background, panelBackgroundFillStyle: background,
    chartTitleFillStyle: textFill, axisTitleFillStyle: textFill, legendTitleFillStyle: textFill,
    chartTitleFont, axisTitleFont,
    // Public XY theme properties are also consumed directly by OpenTest.
    chartXYBackgroundFillStyle: background,
    chartXYTitleFillStyle: textFill, chartXYTitleFont:chartTitleFont,
    xAxisTitleFillStyle:textFill, yAxisTitleFillStyle:textFill, zAxisTitleFillStyle:textFill,
    xAxisTitleFont:axisTitleFont, yAxisTitleFont:axisTitleFont, zAxisTitleFont:axisTitleFont,
    legendTitleFont: new FontSettings({size: sizes.legendTitle ?? 12, family}), font: new FontSettings({size: sizes.other ?? 14, family}),
    tickLabelFillStyle: textFill,
    axisStrokeStyle: new SolidLine({fillStyle: new SolidFill({color: axis})}),
    tickGridStrokeStyle: new SolidLine({fillStyle: new SolidFill({color: grid})}),
    chartXYSeriesBackgroundStrokeStyle: new SolidLine({fillStyle: new SolidFill({color: axis})}),
    chartXYSeriesBackgroundFillStyle: emptyFill,
    uiBackgroundFillStyle: new SolidFill({color: options.uiBackgroundColor ?? (base.backgroundColor as Color)}),
    uiBorderStrokeStyle: new SolidLine({fillStyle: new SolidFill({color: options.uiBorderColor ?? axis})}),
    dataColors: dataColors??[...base.dataColors], effectsDisabled: options.effects === false,
  };
}
export {Themes};
