import { EmpiricalPolicyPanel } from '@/components/predictions/EmpiricalPolicyPanel';
import { TaylorRulePanel } from '@/components/predictions/TaylorRulePanel';

const EmpiricalPolicy = () => {
  return (
    <div className="space-y-6 animate-slide-in max-w-4xl">
      <EmpiricalPolicyPanel />
      <TaylorRulePanel />
    </div>
  );
};

export default EmpiricalPolicy;
