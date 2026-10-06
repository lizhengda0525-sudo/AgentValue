import {
  Children,
  forwardRef,
  isValidElement,
  cloneElement,
  useImperativeHandle,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ChangeEvent,
  type InputEvent,
  type ReactNode,
  type ComponentRef,
  type ReactElement,
} from 'react';
import {
  Button as AntButton,
  Input as AntInput,
  InputNumber,
  Checkbox,
  DatePicker,
  TimePicker,
  Collapse,
  Rate,
  Alert,
  type InputRef,
} from 'antd';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(customParseFormat);

// Preserve the existing form contract; Ant Design owns every visible control.
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }
>(function Button({ type, className = '', children, color: _color, ...props }, ref) {
  if (className.split(' ').includes('av-check'))
    return (
      <Checkbox
        aria-label={props['aria-label']}
        checked={className.split(' ').includes('checked')}
        disabled={props.disabled}
        className="av-task-checkbox"
        onChange={(event) =>
          props.onClick?.(event as unknown as React.MouseEvent<HTMLButtonElement>)
        }
      />
    );
  const action = /(?:^|\s)(?:av-button|button)(?:\s|$)/.test(className);
  return (
    <AntButton
      {...props}
      ref={ref}
      htmlType={type ?? 'button'}
      type={className.split(' ').includes('primary') ? 'primary' : action ? 'default' : 'text'}
      className={`av-ui-button ${action ? 'av-ui-action' : 'av-ui-flat'} ${className}`}
    >
      {children}
    </AntButton>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    const {
      type = 'text',
      value,
      defaultValue,
      onChange,
      onInput,
      name,
      className,
      min,
      max,
      step,
      size: _size,
      ...rest
    } = props;
    const inputRef = useRef<InputRef>(null);
    useImperativeHandle(ref, () => inputRef.current?.input as HTMLInputElement);
    const [internal, setInternal] = useState(String(defaultValue ?? ''));
    const current = value === undefined ? internal : String(value ?? '');
    const emit = (next: string) => {
      setInternal(next);
      const target = { value: next, name: name ?? '' } as HTMLInputElement;
      onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLInputElement>);
      onInput?.({ target, currentTarget: target } as unknown as InputEvent<HTMLInputElement>);
    };
    if (type === 'checkbox')
      return (
        <Checkbox
          {...(rest as object)}
          name={name}
          checked={props.checked}
          defaultChecked={props.defaultChecked}
          className={`av-ui-checkbox ${className ?? ''}`}
          onChange={onChange as never}
        />
      );
    if (type === 'date' || type === 'month' || type === 'year' || type === 'time') {
      const format =
        type === 'year'
          ? 'YYYY'
          : type === 'month'
            ? 'YYYY-MM'
            : type === 'date'
              ? 'YYYY-MM-DD'
              : 'HH:mm';
      const parsed = current ? dayjs(current, format, true) : null;
      const common = {
        id: props.id,
        disabled: props.disabled,
        'aria-label':
          props['aria-label'] ??
          (name === 'deadline'
            ? '截止日期'
            : name === 'date'
              ? '计划日期'
              : name === 'start'
                ? '开始时间'
                : type === 'date'
                  ? '选择日期'
                  : type === 'month'
                    ? '选择月份'
                    : '选择时间'),
        className: `av-ui-picker ${className ?? ''}`,
        value: parsed?.isValid() ? parsed : null,
        onChange: (date: dayjs.Dayjs | null) => emit(date ? date.format(format) : ''),
        format,
        allowClear: !props.required,
        placeholder:
          type === 'year'
            ? '选择年份'
            : type === 'month'
              ? '选择月份'
              : type === 'date'
                ? '选择日期'
                : '选择时间',
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === 'Enter') event.preventDefault();
          if (event.key === 'Enter' || event.key === 'Escape') event.stopPropagation();
        },
        getPopupContainer: () => document.body,
      };
      return (
        <>
          {name && <input type="hidden" name={name} value={current} disabled={props.disabled} />}
          {type !== 'time' ? (
            <DatePicker
              {...common}
              picker={type === 'year' ? 'year' : type === 'month' ? 'month' : 'date'}
            />
          ) : (
            <TimePicker {...common} minuteStep={5} needConfirm={false} />
          )}
        </>
      );
    }
    if (type === 'number')
      return (
        <>
          {name && <input type="hidden" name={name} value={current} disabled={props.disabled} />}
          <InputNumber
            {...(rest as object)}
            className={`av-ui-number ${className ?? ''}`}
            value={current === '' ? null : Number(current)}
            min={min === undefined ? undefined : Number(min)}
            max={max === undefined ? undefined : Number(max)}
            step={step === undefined ? undefined : Number(step)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onChange={(next) => emit(next === null ? '' : String(next))}
          />
        </>
      );
    return (
      <AntInput
        {...rest}
        ref={inputRef}
        type={type}
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        onInput={onInput}
        className={`av-ui-input ${className ?? ''}`}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref) {
  const inner = useRef<ComponentRef<typeof AntInput.TextArea>>(null);
  useImperativeHandle(ref, () => inner.current?.resizableTextArea?.textArea as HTMLTextAreaElement);
  return (
    <AntInput.TextArea
      {...props}
      ref={inner}
      className={`av-ui-textarea ${props.className ?? ''}`}
    />
  );
});

export function Disclosure({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const nodes = Children.toArray(children);
  const summary = nodes.find((node) => isValidElement(node) && node.type === 'summary');
  return (
    <Collapse
      ghost
      className={`av-ui-collapse ${className}`}
      items={[
        {
          key: 'properties',
          label: isValidElement<{ children: ReactNode }>(summary)
            ? summary.props.children
            : '更多属性',
          children: nodes.filter((node) => node !== summary),
        },
      ]}
    />
  );
}

export function RatingField() {
  const [value, setValue] = useState(0);
  return (
    <div className="av-rating-field">
      <input type="hidden" name="rating" value={value} />
      <Rate
        aria-label="效果评分"
        value={value}
        onChange={setValue}
        tooltips={['较差', '一般', '可用', '满意', '优秀']}
        characterRender={(node, { index }) => {
          const star = node as ReactElement<{ children: ReactElement<{ 'aria-label'?: string }> }>;
          return cloneElement(star, {
            children: cloneElement(star.props.children, { 'aria-label': `${(index ?? 0) + 1} 星` }),
          });
        }}
      />
      <span>{value ? `${value} 星` : '暂不评分'}</span>
    </div>
  );
}

export function Feedback({
  text,
  error = false,
  onClose,
  className = '',
}: {
  text: string;
  error?: boolean;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div className={`av-feedback ${className}`} role={error ? undefined : 'status'}>
      <Alert
        title={text}
        type={error ? 'error' : 'success'}
        showIcon
        closable={!!onClose}
        afterClose={onClose}
      />
    </div>
  );
}
