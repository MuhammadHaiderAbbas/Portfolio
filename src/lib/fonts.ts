import { url } from './paths';

// Times New Roman everywhere. Devices without it (Android, Linux) get Tinos,
// an open font drawn to the same measurements, so the layout is identical.
const faces: [string, number, string][] = [
  ['normal', 400, '400-normal'],
  ['italic', 400, '400-italic'],
  ['normal', 700, '700-normal'],
  ['italic', 700, '700-italic'],
];
const local = (weight: number, style: string) => {
  const name = weight >= 600 ? (style === 'italic' ? 'Bold Italic' : 'Bold') : style === 'italic' ? 'Italic' : '';
  const ps = weight >= 600 ? (style === 'italic' ? 'TimesNewRomanPS-BoldItalicMT' : 'TimesNewRomanPS-BoldMT') : style === 'italic' ? 'TimesNewRomanPS-ItalicMT' : 'TimesNewRomanPSMT';
  return `local('Times New Roman${name ? ' ' + name : ''}'),local('${ps}')`;
};
export const fontFaceCss = () =>
  faces
    .map(
      ([style, weight, file]) =>
        `@font-face{font-family:'Site Serif';font-style:${style};font-weight:${weight};font-display:swap;src:${local(weight, style)},url('${url(`/fonts/tinos-${file}.woff2`)}') format('woff2')}`
    )
    .join('');
