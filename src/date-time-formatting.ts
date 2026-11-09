import type {FormattingFunction, FormattingRange} from './formatting-functions.js';

export type DateTimeFormatter = Intl.DateTimeFormatOptions | FormattingFunction;
export type DateTimeTickLevel = 'great' | 'major' | 'minor';
export type DateTimeZoom = 'decade' | 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond';
type Formats = Record<DateTimeTickLevel, DateTimeFormatter | undefined>;

const defaults: Record<DateTimeZoom, Record<DateTimeTickLevel, Intl.DateTimeFormatOptions>> = {
  decade: {great:{}, major:{year:'numeric'}, minor:{year:'numeric'}},
  year: {great:{}, major:{year:'numeric'}, minor:{month:'short'}},
  month: {great:{year:'numeric',hour12:false}, major:{month:'long',hour12:false}, minor:{day:'numeric',hour12:false}},
  week: {great:{year:'numeric',month:'long',hour12:false}, major:{day:'numeric',weekday:'short',hour12:false}, minor:{day:'numeric',weekday:'short',hour12:false}},
  day: {great:{year:'numeric',month:'long'}, major:{day:'numeric'}, minor:{hour:'numeric'}},
  hour: {great:{month:'short',day:'numeric'}, major:{hour:'numeric'}, minor:{hour:'numeric',minute:'2-digit'}},
  minute: {great:{month:'short',day:'numeric'}, major:{hour:'numeric',minute:'2-digit'}, minor:{second:'2-digit'}},
  second: {great:{hour:'numeric',minute:'2-digit'}, major:{second:'2-digit'}, minor:{second:'2-digit',fractionalSecondDigits:3}},
  millisecond: {great:{hour:'numeric',minute:'2-digit',second:'2-digit'}, major:{second:'2-digit',fractionalSecondDigits:3}, minor:{}},
};

function ownFormatter(value: DateTimeFormatter | undefined): DateTimeFormatter | undefined {
  if (value === undefined || typeof value === 'function') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Date time formatter must be a function, Intl options, or undefined');
  const options = {...value};
  // Reject invalid options before changing the active configuration.
  new Intl.DateTimeFormat(undefined, options);
  return options;
}

/** Original formatting state shared by DateTime labels and the public cursor API.
 * Values passed to callbacks are absolute timestamps; the range stays in axis
 * coordinates. Tick placement is deliberately independent of display formatting.
 */
export class DateTimeFormatting {
  private origin: Date | undefined;
  private utc = false;
  private locale: string | undefined;
  private formats: Formats = {great:undefined,major:undefined,minor:undefined};
  private zoomFormats = new Map<DateTimeZoom, Formats>();
  private intlCache = new Map<Intl.DateTimeFormatOptions, Intl.DateTimeFormat>();
  constructor(private readonly invalidate: () => void = () => {}) {}

  setDateOrigin(value: Date | number | undefined) {
    const timestamp = value === undefined ? undefined : +value;
    if (timestamp !== undefined && (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime()))) throw new RangeError('Date origin must be a valid date or undefined');
    this.origin = timestamp === undefined ? undefined : new Date(timestamp);
    this.invalidate();
  }
  getDateOrigin() { return this.origin === undefined ? undefined : new Date(this.origin.getTime()); }
  getOriginTimestamp() { return this.origin?.getTime() ?? 0; }
  setUTC(value: boolean) {
    if (typeof value !== 'boolean') throw new TypeError('UTC mode must be boolean');
    if (this.utc !== value) { this.utc=value; this.intlCache.clear(); this.invalidate(); }
  }
  getUTC() { return this.utc; }
  setLocale(value: string | undefined) {
    if (value !== undefined && typeof value !== 'string') throw new TypeError('Date time locale must be a string or undefined');
    if (value !== undefined) Intl.getCanonicalLocales(value);
    if (this.locale !== value) { this.locale=value; this.intlCache.clear(); this.invalidate(); }
  }
  getLocale() { return this.locale; }
  setFormatting(great: DateTimeFormatter | undefined, major: DateTimeFormatter | undefined, minor?: DateTimeFormatter) {
    const next = {great:ownFormatter(great), major:ownFormatter(major), minor:ownFormatter(minor)};
    this.formats=next; this.zoomFormats.clear(); this.intlCache.clear(); this.invalidate();
  }
  setZoomFormatting(zoom: DateTimeZoom, great: DateTimeFormatter | undefined, major: DateTimeFormatter | undefined, minor?: DateTimeFormatter) {
    const next = {great:ownFormatter(great), major:ownFormatter(major), minor:ownFormatter(minor)};
    this.zoomFormats.set(zoom,next); this.intlCache.clear(); this.invalidate();
  }
  hasCustomFormatting() {
    return Object.values(this.formats).some(value=>value!==undefined) || this.zoomFormats.size>0;
  }
  formatTick(value: number, range: FormattingRange, level: DateTimeTickLevel, zoom: DateTimeZoom): string {
    const timestamp=value+this.getOriginTimestamp();
    const format=(this.zoomFormats.get(zoom) ?? this.formats)[level] ?? defaults[zoom][level];
    if (typeof format === 'function') return String(format(timestamp,{...range},this.locale));
    if (!Number.isFinite(timestamp)) return String(timestamp);
    if (!Number.isFinite(new Date(timestamp).getTime())) return 'Invalid Date';
    let formatter=this.intlCache.get(format);
    if (!formatter) {
      formatter=new Intl.DateTimeFormat(this.locale,{...format,...(this.utc?{timeZone:'UTC'}:{})});
      this.intlCache.set(format,formatter);
    }
    return formatter.format(timestamp);
  }
  formatCursor(value: number, range: FormattingRange, custom?: FormattingFunction): string {
    const timestamp=value+this.getOriginTimestamp();
    // The public cursor callback receives no locale override. This is separate
    // from tick callbacks, which receive the configured DateTime locale.
    if (custom) return String(custom(timestamp,{...range},undefined));
    if (!Number.isFinite(timestamp)) return String(timestamp);
    const date=new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return 'Invalid Date';
    // The native default cursor uses local calendar fields even with UTC tick
    // placement. Consumers can supply a UTC cursor formatter explicitly.
    const pad=(part:number)=>String(part).padStart(2,'0');
    return `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}

/** Select a calendar display scale without converting stored samples. */
export function dateTimeZoomForRange(range: FormattingRange): DateTimeZoom {
  const span=Math.abs(range.end-range.start);
  if (span>=10*365.2425*86400000) return 'decade';
  if (span>=365.2425*86400000) return 'year';
  if (span>=28*86400000) return 'month';
  if (span>=7*86400000) return 'week';
  if (span>=86400000) return 'day';
  if (span>=3600000) return 'hour';
  if (span>=60000) return 'minute';
  if (span>=1000) return 'second';
  return 'millisecond';
}
