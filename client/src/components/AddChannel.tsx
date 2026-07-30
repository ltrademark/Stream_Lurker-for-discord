import { useState } from 'react';
import { parseChannelInput } from '../../../shared/twitch.ts';

type Props = {
  onAdd: (input: string) => void;
};

/**
 * Validates with the same parser the server uses, so obvious mistakes get an
 * answer without a round trip. The server still re-parses — this is a
 * convenience, not a security boundary.
 */
export function AddChannel({ onAdd }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent): void {
    event.preventDefault();

    const parsed = parseChannelInput(value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setError(null);
    setValue('');
    onAdd(parsed.login);
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="add-row">
        <input
          value={value}
          placeholder="Channel name or twitch.tv link"
          aria-label="Twitch channel name or URL"
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" className="primary" disabled={value.trim().length === 0}>
          Add
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </form>
  );
}
