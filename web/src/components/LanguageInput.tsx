import { useState, useRef, useEffect } from 'react';

/**
 * Popular Telegram languages with aliases for fuzzy matching.
 * Aliases include: English name, native name, short codes, common misspellings.
 */
const LANGUAGES = [
  { label: 'English', aliases: ['english', 'eng', 'en', 'англ', 'английский'] },
  { label: 'Russian', aliases: ['russian', 'rus', 'ru', 'рус', 'русский', 'россия', 'russia'] },
  { label: 'Spanish', aliases: ['spanish', 'esp', 'es', 'español', 'испанский', 'испан'] },
  { label: 'Portuguese', aliases: ['portuguese', 'por', 'pt', 'português', 'portugues', 'португальский', 'браз', 'brazil'] },
  { label: 'Arabic', aliases: ['arabic', 'ar', 'arab', 'арабский', 'араб', 'العربية'] },
  { label: 'French', aliases: ['french', 'fr', 'fra', 'français', 'francais', 'французский', 'франц'] },
  { label: 'German', aliases: ['german', 'de', 'deu', 'deutsch', 'немецкий', 'немец'] },
  { label: 'Italian', aliases: ['italian', 'it', 'ita', 'italiano', 'итальянский', 'итал'] },
  { label: 'Turkish', aliases: ['turkish', 'tr', 'tur', 'türkçe', 'turkce', 'турецкий', 'турец'] },
  { label: 'Hindi', aliases: ['hindi', 'hi', 'hin', 'хинди', 'индийский', 'india', 'हिन्दी'] },
  { label: 'Indonesian', aliases: ['indonesian', 'id', 'ind', 'bahasa', 'индонезийский'] },
  { label: 'Ukrainian', aliases: ['ukrainian', 'uk', 'ukr', 'українська', 'украинский', 'укр', 'україна'] },
  { label: 'Persian', aliases: ['persian', 'fa', 'farsi', 'فارسی', 'персидский', 'иран', 'iran'] },
  { label: 'Korean', aliases: ['korean', 'ko', 'kor', '한국어', 'корейский', 'корея'] },
  { label: 'Japanese', aliases: ['japanese', 'ja', 'jpn', '日本語', 'японский', 'япон'] },
  { label: 'Chinese', aliases: ['chinese', 'zh', 'zho', '中文', 'китайский', 'кит', 'china'] },
  { label: 'Uzbek', aliases: ['uzbek', 'uz', 'uzb', "o'zbek", 'узбекский', 'узбек'] },
  { label: 'Kazakh', aliases: ['kazakh', 'kz', 'kaz', 'қазақ', 'казахский', 'казах'] },
  { label: 'Thai', aliases: ['thai', 'th', 'tha', 'ไทย', 'тайский', 'тай'] },
  { label: 'Vietnamese', aliases: ['vietnamese', 'vi', 'vie', 'tiếng việt', 'вьетнамский', 'вьетнам'] },
  { label: 'Polish', aliases: ['polish', 'pl', 'pol', 'polski', 'польский', 'поль'] },
  { label: 'Dutch', aliases: ['dutch', 'nl', 'nld', 'nederlands', 'голландский', 'нидерланд'] },
  { label: 'Romanian', aliases: ['romanian', 'ro', 'ron', 'română', 'румынский'] },
  { label: 'Czech', aliases: ['czech', 'cs', 'ces', 'čeština', 'чешский', 'чех'] },
  { label: 'Malay', aliases: ['malay', 'ms', 'msa', 'melayu', 'малайский'] },
  { label: 'Bengali', aliases: ['bengali', 'bn', 'ben', 'বাংলা', 'бенгальский'] },
];

interface LanguageInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  header?: string;
}

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 100,
  background: 'var(--tg-theme-bg-color, #fff)',
  border: '1px solid var(--tg-theme-hint-color, #ccc)',
  borderRadius: '0 0 10px 10px',
  maxHeight: 200,
  overflowY: 'auto',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
};

const itemStyle: React.CSSProperties = {
  padding: '10px 16px',
  cursor: 'pointer',
  fontSize: 15,
  color: 'var(--tg-theme-text-color, #000)',
};

const itemHoverStyle: React.CSSProperties = {
  ...itemStyle,
  background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
};

export function LanguageInput({ value, onChange, placeholder, header }: LanguageInputProps) {
  const [open, setOpen] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const query = value.toLowerCase().trim();

  const suggestions = query.length > 0
    ? LANGUAGES.filter(lang =>
        lang.label.toLowerCase().startsWith(query) ||
        lang.aliases.some(a => a.startsWith(query))
      ).slice(0, 6)
    : [];

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (label: string) => {
    onChange(label);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHoveredIdx(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHoveredIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && hoveredIdx >= 0) {
      e.preventDefault();
      handleSelect(suggestions[hoveredIdx].label);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {header && (
        <div style={{
          fontSize: 13,
          color: 'var(--tg-theme-hint-color, #999)',
          padding: '8px 16px 2px',
        }}>
          {header}
        </div>
      )}
      <input
        type="text"
        value={value}
        placeholder={placeholder || 'e.g. English, Russian'}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHoveredIdx(-1);
        }}
        onFocus={() => { if (query.length > 0) setOpen(true); }}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          padding: '12px 16px',
          fontSize: 16,
          border: 'none',
          borderBottom: '0.5px solid var(--tg-theme-hint-color, #ddd)',
          background: 'transparent',
          color: 'var(--tg-theme-text-color, #000)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {open && suggestions.length > 0 && (
        <div style={dropdownStyle}>
          {suggestions.map((lang, i) => (
            <div
              key={lang.label}
              style={i === hoveredIdx ? itemHoverStyle : itemStyle}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseDown={() => handleSelect(lang.label)}
            >
              {lang.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
