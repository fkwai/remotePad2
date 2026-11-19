export function iconControl(control: HTMLButtonElement, label: string, kind: 'layout' | 'refresh') {
  control.replaceChildren();
  control.classList.add('icon-button'); control.title = label; control.setAttribute('aria-label', label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.4');
  if (kind === 'layout') for (const [x,y,w,h] of [[2,3,4,14],[8,3,4,6],[8,11,4,6],[14,3,4,14]]) {
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    for (const [key,value] of Object.entries({x,y,width:w,height:h,rx:0.7})) rect.setAttribute(key, String(value)); svg.append(rect);
  } else {
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'M16 8a6.2 6.2 0 1 0 .1 4M16 3v5h-5'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path);
  }
  control.append(svg); return control;
}
