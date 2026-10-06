import { useState, type FormEvent } from 'react';
import { ModalShell } from '../ModalShell';
import { Button, Input, Textarea } from '../ui';
import { ChoiceSelect } from '../ChoiceSelect';
import { categoryInfo, type Category } from './model';
import type { Goal } from './persistence';
export function GoalEditor({
  goal,
  onSave,
  onClose,
  onDelete,
}: {
  goal: Goal;
  onSave: (goal: Goal) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(goal);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    onSave({
      ...draft,
      title: draft.title.trim(),
      project: draft.project.trim() || draft.title.trim(),
    });
  };
  return (
    <ModalShell title={draft.period === 'year' ? '年度目标' : '月度目标'} onClose={onClose}>
      <form className="av-quick-form" onSubmit={submit}>
        <label>
          目标名称
          <Input
            required
            maxLength={160}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <div className="av-form-grid">
          <label>
            目标周期
            <ChoiceSelect
              aria-label="目标周期"
              value={draft.period || 'month'}
              onChange={(event) =>
                setDraft({ ...draft, period: event.target.value as 'month' | 'year' })
              }
            >
              <option value="month">月度目标</option>
              <option value="year">年度目标</option>
            </ChoiceSelect>
          </label>
          <label>
            {draft.period === 'year' ? '目标年份' : '目标月份'}
            <Input
              type={draft.period === 'year' ? 'year' : 'month'}
              aria-label={draft.period === 'year' ? '目标年份' : '目标月份'}
              required
              value={draft.period === 'year' ? draft.month.slice(0, 4) : draft.month}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  month: draft.period === 'year' ? `${e.target.value}-01` : e.target.value,
                })
              }
            />
          </label>
          <label>
            分类
            <ChoiceSelect
              aria-label="目标分类"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}
            >
              {Object.entries(categoryInfo).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </ChoiceSelect>
          </label>
        </div>
        <label>
          关联项目
          <Input
            maxLength={160}
            placeholder="默认使用目标名称；同项目事项会计入进度"
            value={draft.project}
            onChange={(e) => setDraft({ ...draft, project: e.target.value })}
          />
        </label>
        <label>
          说明
          <Textarea
            rows={3}
            maxLength={2000}
            value={draft.hint}
            onChange={(e) => setDraft({ ...draft, hint: e.target.value })}
          />
        </label>
        <div className="av-quick-footer">
          {onDelete && goal.title && (
            <Button danger onClick={onDelete}>
              删除目标
            </Button>
          )}
          <Button type="submit" className="av-button primary">
            保存目标
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
