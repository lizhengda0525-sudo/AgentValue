import { Children, isValidElement, useId, useState, type ReactNode } from 'react';
import { Select } from 'antd';
type Props = {
  children: ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  name?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
};
function flattenOptions(
  children: ReactNode,
): { value: string; label: ReactNode; disabled?: boolean }[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)
    )
      return [];
    if (child.type !== 'option') return flattenOptions(child.props.children);
    return [
      {
        value: String(child.props.value ?? child.props.children ?? ''),
        label: child.props.children,
        disabled: child.props.disabled,
      },
    ];
  });
}
export function ChoiceSelect({
  children,
  value,
  defaultValue,
  onChange,
  name,
  id,
  className = '',
  disabled,
  required,
  'aria-label': label,
}: Props) {
  const options = flattenOptions(children);
  const [internal, setInternal] = useState(String(defaultValue ?? options[0]?.value ?? ''));
  const selected = value === undefined ? internal : String(value);
  const autoId = useId();
  return (
    <>
      {name && <input type="hidden" name={name} value={selected} disabled={disabled} />}
      <Select
        id={id || autoId}
        className={`av-ui-select ${className}`}
        aria-label={label}
        aria-required={required}
        disabled={disabled}
        value={selected}
        options={options}
        popupMatchSelectWidth={false}
        onInputKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation();
        }}
        getPopupContainer={(trigger) => trigger.parentElement!}
        onChange={(next) => {
          setInternal(next);
          onChange?.({ target: { value: next } });
        }}
      />
    </>
  );
}
