import { useSearchParams } from 'react-router';
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './appearance.js';
import { ColorDot } from './record-tags.js';
import { validRecordColor } from './record-colors.js';
export interface SelectOption {
  id: string;
  name: string;
  searchText?: string;
  disabled?: boolean;
  color?: string | null;
}
const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
export function SearchSelect({
  options,
  value,
  onChange,
  label,
  placeholder = 'Selecione…',
  required = false,
  disabled = false,
  name,
  allowClear = true,
  className = '',
  popupClassName = '',
  renderOptionLeading,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  allowClear?: boolean;
  className?: string;
  popupClassName?: string;
  renderOptionLeading?: (option: SelectOption) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    height: 240,
    upwards: false,
  });
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  const selected = options.find((option) => option.id === value);
  const filtered = options.filter((option) =>
    normalized(option.name + ' ' + (option.searchText ?? '')).includes(normalized(query)),
  );
  const available = filtered.filter((option) => !option.disabled);
  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.id);
    setOpen(false);
    setQuery('');
    input.current?.focus();
  }
  useEffect(() => {
    input.current?.setCustomValidity(required && !value ? 'Selecione uma opção da lista.' : '');
  }, [value, required]);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 180 && above > below;
      const height = Math.min(300, Math.max(120, upwards ? above : below));
      const next = {
        top: upwards ? rect.top - 6 : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        width: Math.min(rect.width, window.innerWidth - 16),
        height,
        upwards,
      };
      setPosition((previous) =>
        Object.keys(next).every(
          (key) => previous[key as keyof typeof next] === next[key as keyof typeof next],
        )
          ? previous
          : next,
      );
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !anchor.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => {
    if (open)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  return (
    <div
      className={`search-select ${className} ${validRecordColor(selected?.color) ? 'has-record-color' : ''} ${disabled ? 'is-disabled' : ''} ${allowClear && value && !disabled ? 'has-clear' : ''}`}
      ref={anchor}
    >
      {!open && <ColorDot color={selected?.color} />}
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && available[active] ? `${id}-option-${active}` : undefined}
        placeholder={open ? (selected?.name ?? placeholder) : placeholder}
        value={open ? query : (selected?.name ?? '')}
        autoComplete="off"
        aria-required={required}
        required={required && !value}
        disabled={disabled}
        onFocus={() => {
          if (!disabled) {
            setOpen(true);
            setQuery('');
            setActive(0);
          }
        }}
        onClick={() => {
          if (!open) {
            setOpen(true);
            setQuery('');
            setActive(0);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => {
            if (!anchor.current?.contains(document.activeElement)) {
              setOpen(false);
              setQuery('');
            }
          }, 0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setQuery('');
          } else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            setActive((current) =>
              Math.max(
                0,
                Math.min(available.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
              ),
            );
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            event.stopPropagation();
            if (available[active]) choose(available[active]);
          } else if (event.key === 'Tab') {
            setOpen(false);
            setQuery('');
          }
        }}
      />
      {name && <input type="hidden" name={name} value={value} />}
      <span className="select-indicators">
        {allowClear && value && !disabled && (
          <button
            type="button"
            className="select-clear"
            aria-label={`Limpar ${label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              setQuery('');
              setActive(0);
              setOpen(true);
              input.current?.focus();
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
        <Icon name={open ? 'search' : 'chevron'} size={16} />
      </span>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={popup}
            id={`${id}-list`}
            className={`select-popup ${popupClassName}`}
            role="listbox"
            aria-label={`Opções de ${label}`}
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.height,
              transform: position.upwards ? 'translateY(-100%)' : undefined,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="select-search-hint">
              <Icon name="search" size={14} />
              Digite para buscar · ↑ ↓ para navegar
            </div>
            {filtered.length ? (
              filtered.map((option) => {
                const index = available.indexOf(option);
                return (
                  <div
                    key={option.id || 'empty'}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={option.id === value}
                    aria-disabled={option.disabled || undefined}
                    className={`select-option ${index === active ? 'highlighted' : ''} ${option.disabled ? 'disabled' : ''}`}
                    onMouseEnter={() => {
                      if (index >= 0) setActive(index);
                    }}
                    onClick={() => choose(option)}
                  >
                    <span className="record-option-label">
                      {renderOptionLeading?.(option)}
                      <ColorDot color={option.color} />
                      {option.name}
                    </span>
                    {option.id === value && <Icon name="check" size={16} />}
                  </div>
                );
              })
            ) : (
              <div className="select-empty">Nenhuma opção encontrada.</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
export interface TabProps {
  id: string;
  label: string;
  count?: number;
  children: ReactNode;
}
export function Tab({ children }: TabProps) {
  return <>{children}</>;
}
export function Tabs({ children, label }: { children: ReactNode; label: string }) {
  const tabs = Children.toArray(children).filter(isValidElement) as ReactElement<TabProps>[];
  const [params, setParams] = useSearchParams();
  const slug = (tab: ReactElement<TabProps>) =>
    normalized(tab.props.label)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const selected =
    tabs.find((tab) => slug(tab) === params.get('aba'))?.props.id ?? tabs[0]?.props.id;
  function setSelected(value: string) {
    const next = new URLSearchParams(params);
    next.set('aba', slug(tabs.find((tab) => tab.props.id === value)!));
    void setParams(next, { preventScrollReset: true });
  }
  const id = useId().replace(/:/g, '');
  const active = tabs.some((tab) => tab.props.id === selected) ? selected : tabs[0]?.props.id;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="tabs-group">
      <div className="section-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.props.id}
            type="button"
            ref={(element) => {
              refs.current[index] = element;
            }}
            role="tab"
            id={`${id}-tab-${tab.props.id}`}
            aria-controls={`${id}-panel-${tab.props.id}`}
            aria-selected={active === tab.props.id}
            tabIndex={active === tab.props.id ? 0 : -1}
            onClick={() => setSelected(tab.props.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = tabs.length - 1;
              else return;
              event.preventDefault();
              setSelected(tabs[next].props.id);
              refs.current[next]?.focus();
            }}
          >
            {tab.props.label}
            {tab.props.count !== undefined && <span>{tab.props.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map(
        (tab) =>
          active === tab.props.id && (
            <section
              key={tab.props.id}
              role="tabpanel"
              id={`${id}-panel-${tab.props.id}`}
              aria-labelledby={`${id}-tab-${tab.props.id}`}
              tabIndex={0}
            >
              {tab.props.children}
            </section>
          ),
      )}
    </div>
  );
}
