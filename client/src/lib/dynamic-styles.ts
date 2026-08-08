let _sheet: CSSStyleSheet | null = null;
const _rules = new Map<string, string>();

function getSheet(): CSSStyleSheet {
  if (!_sheet) {
    _sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, _sheet];
  }
  return _sheet;
}

function flush(): void {
  const combined = Array.from(_rules.values()).join("\n");
  getSheet().replaceSync(combined);
}

export function setRule(id: string, css: string): void {
  _rules.set(id, css);
  flush();
}

export function removeRule(id: string): void {
  if (_rules.delete(id)) {
    flush();
  }
}
