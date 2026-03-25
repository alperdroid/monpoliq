import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Plus, Trash2, Bell, Clock, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

interface AlertRule {
  id: string;
  name: string;
  rule_type: string;
  bank: string | null;
  metric: string;
  operator: string;
  threshold: number;
  is_active: boolean;
  email_notify: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

interface AlertHistoryEntry {
  id: string;
  rule_id: string;
  triggered_at: string;
  current_value: number;
  message: string;
}

const METRIC_OPTIONS = [
  { value: 'fed_score', label: 'Fed Sentiment Score' },
  { value: 'ecb_score', label: 'ECB Sentiment Score' },
  { value: 'fed_ecb_spread', label: 'Fed-ECB Spread' },
  { value: 'fed_comms_count', label: 'Fed Comms Count' },
  { value: 'ecb_comms_count', label: 'ECB Comms Count' },
];

const OPERATOR_OPTIONS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '≥' },
  { value: 'lte', label: '≤' },
  { value: 'eq', label: '=' },
];

const PRESETS = [
  { name: 'Fed-ECB Spread > 0.4', metric: 'fed_ecb_spread', operator: 'gt', threshold: 0.4 },
  { name: 'Fed Turns Dovish', metric: 'fed_score', operator: 'lt', threshold: -0.1 },
  { name: 'ECB Turns Hawkish', metric: 'ecb_score', operator: 'gt', threshold: 0.15 },
];

export function AlertRulesPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formMetric, setFormMetric] = useState('fed_ecb_spread');
  const [formOperator, setFormOperator] = useState('gt');
  const [formThreshold, setFormThreshold] = useState('0.4');
  const [formEmail, setFormEmail] = useState(true);

  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['alert-rules', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_rules' as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as AlertRule[];
    },
    enabled: !!user,
  });

  const { data: history = [] } = useQuery({
    queryKey: ['alert-history', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_history' as any)
        .select('*')
        .order('triggered_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as AlertHistoryEntry[];
    },
    enabled: !!user,
  });

  const createRule = useMutation({
    mutationFn: async (rule: Partial<AlertRule>) => {
      const { error } = await (supabase.from('alert_rules' as any) as any).insert({
        ...rule,
        user_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      toast.success('Alert rule created');
      setShowForm(false);
      setFormName('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase.from('alert_rules' as any) as any).update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert-rules'] }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('alert_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      toast.success('Rule deleted');
    },
  });

  if (!user) {
    return (
      <div className="text-center py-12 space-y-4">
        <Bell className="w-8 h-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">Sign in to create and manage alerts</p>
        <div className="flex gap-2 justify-center">
          <Link to="/login"><Button variant="outline" size="sm">Sign In</Button></Link>
          <Link to="/signup"><Button size="sm">Create Account</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Your Alert Rules</h2>
          <p className="text-[10px] text-muted-foreground">{rules.length} rules configured</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs h-7" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-3 h-3" /> Add Rule
        </Button>
      </div>

      {/* Presets */}
      <div className="flex gap-2 flex-wrap">
        {PRESETS.map((preset, i) => (
          <Button
            key={i}
            variant="outline"
            size="sm"
            className="text-[10px] h-6"
            onClick={() => {
              setFormName(preset.name);
              setFormMetric(preset.metric);
              setFormOperator(preset.operator);
              setFormThreshold(String(preset.threshold));
              setShowForm(true);
            }}
          >
            {preset.name}
          </Button>
        ))}
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="rounded-lg border border-primary/30 bg-surface p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-[10px]">Rule Name</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g., Fed-ECB Spread Alert" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Metric</Label>
              <Select value={formMetric} onValueChange={setFormMetric}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METRIC_OPTIONS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Operator</Label>
                <Select value={formOperator} onValueChange={setFormOperator}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATOR_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Threshold</Label>
                <Input type="number" step="0.01" value={formThreshold} onChange={e => setFormThreshold(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={formEmail} onCheckedChange={setFormEmail} />
              <span className="text-[10px] text-muted-foreground">Email notifications</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => createRule.mutate({
                name: formName || `${formMetric} ${formOperator} ${formThreshold}`,
                rule_type: 'threshold',
                metric: formMetric,
                operator: formOperator,
                threshold: parseFloat(formThreshold),
                email_notify: formEmail,
                is_active: true,
              })}>
                Create Rule
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rules List */}
      <div className="space-y-2">
        {rules.map(rule => (
          <div key={rule.id} className={cn(
            'rounded-lg border bg-card p-3 flex items-center justify-between transition-opacity',
            !rule.is_active && 'opacity-50',
          )}>
            <div className="space-y-0.5">
              <p className="text-xs font-medium">{rule.name}</p>
              <p className="text-[10px] text-muted-foreground font-mono">
                {rule.metric} {OPERATOR_OPTIONS.find(o => o.value === rule.operator)?.label || rule.operator} {rule.threshold}
              </p>
              {rule.last_triggered_at && (
                <p className="text-[9px] text-signal-hawkish flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Last: {new Date(rule.last_triggered_at).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={rule.is_active}
                onCheckedChange={is_active => toggleRule.mutate({ id: rule.id, is_active })}
              />
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteRule.mutate(rule.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Recent Triggers
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {history.map(h => (
              <div key={h.id} className="flex items-center gap-2 text-[10px] p-2 rounded bg-surface">
                <span className="text-muted-foreground font-mono w-32 flex-shrink-0">
                  {new Date(h.triggered_at).toLocaleString()}
                </span>
                <span className="text-foreground truncate">{h.message}</span>
                <span className="font-mono font-bold text-signal-hawkish ml-auto flex-shrink-0">
                  {h.current_value.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
