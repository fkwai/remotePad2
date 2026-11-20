export type IconKind = 'layout' | 'refresh' | 'search' | 'favorite' | 'repo' | 'folder' | 'hidden' | 'chevron' | 'file';
export function iconControl(control: HTMLButtonElement, label: string, kind: IconKind) {
  control.replaceChildren();
  control.classList.add('icon-button'); control.title = label; control.setAttribute('aria-label', label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  if (kind === 'layout') for (const [x,y,w,h] of [[2,3,4,14],[8,3,4,6],[8,11,4,6],[14,3,4,14]]) {
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    for (const [key,value] of Object.entries({x,y,width:w,height:h,rx:0.7})) rect.setAttribute(key, String(value)); svg.append(rect);
  } else {
    const shapes: Record<Exclude<IconKind,'layout'>,string> = {
      refresh:'M16 8a6.2 6.2 0 1 0 .1 4M16 3v5h-5',
      search:'M13.5 13.5 18 18M15 8.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
      favorite:'m10 2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L2.2 7.7l5.4-.8Z',
      repo:'M4 4v9a3 3 0 0 0 3 3h1m2-1 2 1-2 1M4 7h8a3 3 0 0 0 3-3M6 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m11 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0m-1 13a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
      folder:'M2 6V4h6l2 2h8v11H2ZM2 8h16',
      hidden:'M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Zm10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
      chevron:'m7 5 5 5-5 5',
      file:'M5 2h7l4 4v12H5ZM12 2v5h4M8 11h5M8 14h5',
    };
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', shapes[kind]); svg.append(path);
  }
  control.append(svg); return control;
}
