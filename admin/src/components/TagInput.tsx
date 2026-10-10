interface TagInputProps {
  value: string[];
  onChange(next: string[]): void;
  placeholder?: string;
}

export function TagInput({ value, onChange, placeholder }: TagInputProps) {
  const commit = (raw: string): void => {
    const parts = raw
      .split(/[,，]/)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    if (parts.length === 0) return;
    const next = [...value];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    onChange(next);
  };

  return (
    <div class="tags">
      {value.map((item) => (
        <span class="chip" key={item}>
          {item}
          <button type="button" title="移除" onClick={() => onChange(value.filter((x) => x !== item))}>
            ×
          </button>
        </span>
      ))}
      <input
        placeholder={value.length === 0 ? placeholder : ''}
        onKeyDown={(event) => {
          const input = event.currentTarget;
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit(input.value);
            input.value = '';
            return;
          }
          if (event.key === 'Backspace' && input.value === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={(event) => {
          const input = event.currentTarget;
          if (input.value.trim() !== '') {
            commit(input.value);
            input.value = '';
          }
        }}
      />
    </div>
  );
}