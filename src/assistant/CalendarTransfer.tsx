import { useState } from 'react';
import { Alert, Table, Upload } from 'antd';
import { ModalShell } from '../ModalShell';
import { Button } from '../ui';
import { parseCalendar } from './calendar-file';
import type { Task } from './model';

export function CalendarTransfer({
  tasks,
  date,
  onImport,
  onClose,
}: {
  tasks: Task[];
  date: string;
  onImport: (tasks: Task[]) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Task[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const fresh = preview.filter((item) => !tasks.some((task) => task.id === item.id));
  return (
    <ModalShell title="导入日历" wide onClose={onClose}>
      <div className="av-quick-form">
        <p>
          单次、全天与跨日事件会转换为事项。重复事件展开为所选日期 {date}{' '}
          起一年内的独立事项；再次导入会跳过已有事件。
        </p>
        <Upload.Dragger
          accept=".ics,text/calendar"
          maxCount={1}
          showUploadList={false}
          disabled={busy}
          beforeUpload={async (file) => {
            setError('');
            setBusy(true);
            setPreview([]);
            setWarnings([]);
            try {
              if (file.size > 2 * 1024 ** 2) throw new Error('文件超过 2 MB');
              const result = await parseCalendar(await file.text(), date);
              setPreview(result.tasks);
              setWarnings(result.warnings);
            } catch (e) {
              setError(e instanceof Error ? e.message : '读取失败');
            } finally {
              setBusy(false);
            }
            return false;
          }}
        >
          <p>{busy ? '正在解析日历…' : '选择或拖入 ICS 文件'}</p>
        </Upload.Dragger>
        {error && <Alert type="error" title={error} showIcon />}
        {!!warnings.length && (
          <Alert
            type="warning"
            title={`有 ${warnings.length} 个事件未导入`}
            description={warnings.slice(0, 10).map((item, i) => (
              <p key={i}>{item}</p>
            ))}
          />
        )}
        {!!preview.length && (
          <Table
            size="small"
            rowKey="id"
            dataSource={preview}
            pagination={{ pageSize: 6 }}
            columns={[
              { title: '事项', dataIndex: 'title' },
              { title: '日期', dataIndex: 'date' },
              {
                title: '时间',
                render: (_, task: Task) => (task.start ? `${task.start}—${task.end}` : '全天'),
              },
            ]}
          />
        )}
        <div className="av-quick-footer">
          <span>
            新增 {fresh.length} 项 · 跳过 {preview.length - fresh.length} 项
          </span>
          <Button
            className="av-button primary"
            disabled={busy || !fresh.length || tasks.length + fresh.length > 20000}
            onClick={() => onImport(fresh)}
          >
            确认导入
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
