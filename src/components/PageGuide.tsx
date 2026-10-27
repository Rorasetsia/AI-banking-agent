import { useEffect, useId, useRef } from 'react';
import { ArrowRight, BookOpen, ShieldCheck, X } from 'lucide-react';
import type { Route } from '../types';

interface GuideSection {
  title: string;
  text: string;
}

interface GuideContent {
  eyebrow: string;
  title: string;
  intro: string;
  sections: GuideSection[];
  safety: string;
}

export const PAGE_GUIDES: Record<Route, GuideContent> = {
  green: {
    eyebrow: '消费与绿色生活',
    title: '选一件事，试着开始',
    intro: '先比较选择，再用一个7天小目标记录行动。计算器无需授权账单。',
    sections: [
      { title: '换新值不值 / 通勤怎么选', text: '输入你自己的报价、能耗或通勤费用，算总支出与时间。示例仅供体验。' },
      { title: '一个7天小目标', text: '选一项行动和天数，点击日期记录或撤销。自行记录与账单线索分别标注。' },
      { title: '消费表现与依据', text: '在页底自愿开启交通支付分析；可纠正分类、查看原流水。' },
    ],
    safety: '费用是输入情景估算，行动天数不等于减排量。需要进一步讨论时进入同一个AI助手；资金操作仍需独立确认与双因子核验。',
  },
  cover: {
    eyebrow: '开始之前',
    title: '欢迎来到小苔',
    intro: '这是一个独立的银行沙箱，账户、流水和交易都使用合成数据。',
    sections: [],
    safety: '不会连接真实银行卡，也不会发生真实扣款。',
  },
  overview: {
    eyebrow: '页面导览',
    title: '总览：先看钱，再看下一步',
    intro: '总览把活期余额、近期流水、本月结构和待办计划放在同一屏，适合每天打开先确认状态。',
    sections: [
      { title: '资产卡', text: '活期余额是可使用的主账户资金；已预留是暂时不能动用的预算，两者不会混在一起。' },
      { title: '顶部提问', text: '在顶部输入安排，按回车或发送后会进入 AI 助手并自动发送；“历史对话”可查看往日记录。Shift+Enter 换行。涉及资金时先生成方案，不会立即扣款。' },
      { title: '右侧待办', text: '待确认计划、预约和未来30日现金流依次排列。近期交易、分类支出和已排期扣款都来自当前沙箱状态。' },
    ],
    safety: '总览中的金额都是合成数据；计划是否执行以确认后的服务端凭证为准。',
  },
  assistant: {
    eyebrow: '页面导览',
    title: 'AI 助手：说清楚要做什么',
    intro: '说出目标，助手会核对条件、给出可查看依据的方案，再由你选择下一步。存钱目标只做规划，办理资金操作另行确认。',
    sections: [
      { title: '目标与规划', text: '例如“我今年要攒十万块”。先分清累计或新增目标，再结合本金、应急金、月收支与期限计算，保存后可在预约与凭证继续查看。' },
      { title: '写操作', text: '转账、申赎、锁卡等会先显示完整方案，再要求交易密码与设备核验。' },
      { title: '改口和纠正', text: '没确认前可以继续补充或修改；已执行的计划不会因为一句话被悄悄覆盖。' },
    ],
    safety: '不要在聊天里输入密码、验证码或真实敏感资料。',
  },
  accounts: {
    eyebrow: '页面导览',
    title: '账户服务：一张卡看全余额',
    intro: '这里只保留最常用的账户动作。卡片显示可用资金，下面三个入口分别处理转账、存入转出和银行卡。',
    sections: [
      { title: '可用余额', text: '可用余额已经扣除预算预留；点眼睛图标可以隐藏金额，适合展示或录屏。' },
      { title: '三个快捷入口', text: '转账收款进入联系人转账和 AA；“存入转出”进入本人银行卡互转，在页内选择方向；银行卡进入额度、锁定和挂失。' },
      { title: '理财单独一页', text: '持仓估值和理财操作不混在活期账户里，点“理财账户”可以单独查看和申赎。' },
    ],
    safety: '三个入口都需要先生成方案；真正改变资金时仍要交易密码和已绑定设备。',
  },
  transfers: {
    eyebrow: '页面导览',
    title: '转账收款：先选人，再核对',
    intro: '支持联系人转账、手机号收款、AA 分摊和预约转账。收款人重名时会先让你确认。',
    sections: [
      { title: '转账', text: '填写收款人和金额后生成方案。备注不会替代收款人，也不会被当成系统指令。' },
      { title: 'AA 与预约', text: 'AA 只生成待付款请求，不代表对方已经付款；预约会保留明确对象、金额和时间。' },
      { title: '确认', text: '方案页会列出实际扣款、到账对象和风险提示，确认后才进入双因子核验。' },
    ],
    safety: '转账是资金操作，不使用操作码，也不能跳过设备验证。',
  },
  funding: {
    eyebrow: '页面导览',
    title: '存入与转出：本人账户之间互转',
    intro: '这里只允许本人名下的合成银行卡与主账户互转，两边的余额会同时更新。',
    sections: [
      { title: '存入', text: '从本人合成卡转入主账户；来源卡余额减少，主账户余额增加。' },
      { title: '转出', text: '从主账户回到本人合成卡；预算预留资金不能被转出。' },
      { title: '记录', text: '每次成功互转会留下真实沙箱流水，但不会计入消费或投资收益。' },
    ],
    safety: '不接受任意第三方卡号，不连接真实银行，也不会发生真实充值。',
  },
  wealth: {
    eyebrow: '页面导览',
    title: '理财：先做适当性，再看产品',
    intro: '这里是独立的模拟理财页。产品名称和公开资料可以参考，净值、风险档位和交易仍是演示。',
    sections: [
      { title: '风险问卷', text: '点击叠层卡片进入12题、4个部分的评估，了解投资经历、资金用途、承受能力和基础知识；结果仅用于项目演示。' },
      { title: '比较与申购', text: '申购前要选择状态正常的借记卡并确认本金可能损失的风险告知。' },
      { title: '持仓与赎回', text: '份额、现金和持仓估值分开显示，赎回计划确认后才会改变沙箱资产。' },
    ],
    safety: '展示收益不是承诺，不接销售机构、行情或真实支付。',
  },
  cards: {
    eyebrow: '页面导览',
    title: '银行卡：额度、锁定与挂失',
    intro: '卡片页集中处理用卡安全和额度，不混入转账或理财操作。',
    sections: [
      { title: '锁定与挂失', text: '锁定可以恢复，挂失会阻断后续交易；每一次状态变更都会先生成方案。' },
      { title: '额度', text: '可查看单笔限额并提交额度调整方案，服务端会重新核对当前卡状态。' },
      { title: '申请', text: '新卡申请只保存为待审核的模拟记录，不会假装银行已经批准。' },
    ],
    safety: '卡片写操作属于资金安全设置，需要交易密码和设备验证。',
  },
  bills: {
    eyebrow: '页面导览',
    title: '账单洞察：看清钱去了哪里',
    intro: '账单页按时间段和分类查看流水，总流入、总流出、消费、投资和转账分开统计。',
    sections: [
      { title: '筛选', text: '可以切换月份、年份和分类；顶部汇总始终按当前筛选条件重新计算。' },
      { title: '异常与来源', text: '这里保留当前筛选中的大额与重复支出线索和来源流水；后续核对与争议材料统一前往扣费监测，不会自动认定诈骗。' },
      { title: '导出', text: '导出的 CSV 只包含当前筛选结果和合成数据，方便离线检查。' },
    ],
    safety: '投资流入流出不等于收益，总流出也不等于亏损或利润。',
  },
  subscriptions: {
    eyebrow: '页面导览',
    title: '订阅与代扣：管理持续扣费授权',
    intro: '这里展示订阅授权、周期扣款候选和下次扣费预测；周期候选不等于重复扣款异常。异常核对与争议草稿统一在扣费监测。',
    sections: [
      { title: '识别', text: '系统只根据沙箱流水给出候选，不会把相似名称自动认定成同一商户。' },
      { title: '取消', text: '取消模拟代扣授权会先生成方案，确认后只改变沙箱状态和未来预测。' },
      { title: '续费', text: '下一次扣费是演示预测，不连接真实商户，也不会真实发起续费。' },
      { title: '监测状态', text: '只有有效、未暂停且没有排除此订阅的订阅监测规则才算覆盖；可从卡片前往扣费监测查看或设置，不会自动扩大授权。' },
    ],
    safety: '取消订阅属于敏感状态变更，需要交易密码和设备核验。',
  },
  tasks: {
    eyebrow: '页面导览',
    title: '预约与凭证：计划走到哪一步',
    intro: '按卡片核对待你确认的操作方案、预约执行与凭证、已预留的预算资金及预约购买记录。',
    sections: [
      { title: '状态', text: '待确认、已执行、已取消、已过期和待重新授权含义不同，以服务端状态为准。' },
      { title: '授权范围', text: '预约只继承已经确认的对象、金额、时间和卡片；条件改变会停下等待重新授权。' },
      { title: '凭证', text: '执行成功后会生成凭证和流水编号；响应丢失时先刷新，不要重复新建交易。' },
    ],
    safety: '预约时间模拟只推进本机沙箱时间；预约购买记录不会向真实商户下单。',
  },
  mandates: {
    eyebrow: '页面导览',
    title: '扣费监测：有限检查与异常处理',
    intro: '有限委托用于定期检查订阅和大额异常，只生成站内提醒，不会自动取消代扣或转账。',
    sections: [
      { title: '监测范围', text: '有效期、检查间隔、金额线和排除对象都会写进方案，不会静默扩大授权。' },
      { title: '异常核对', text: '重复扣款只是候选线索，可以查看来源流水并生成未提交的争议草稿。' },
      { title: '后续处理', text: '前往订阅与代扣生成取消方案，或前往银行卡核对卡状态；这里不会再复制取消或锁卡流程。客服仍可从AI助手咨询。' },
    ],
    safety: '委托不会获得余额、完整流水或资金操作权限。',
  },
  family: {
    eyebrow: '页面导览',
    title: '家庭提醒：知情，不代管',
    intro: '家庭提醒让家人在约定的大额事件发生时收到站内提示，但看不到你的余额、完整流水和交易权限。',
    sections: [
      { title: '创建家庭', text: '选择关系、提醒线和是否展示金额，生成 30 分钟内有效的一次性邀请码。' },
      { title: '加入家庭', text: '管理人输入邀请码并单独同意，只会收到授权范围内的提醒。' },
      { title: '家庭管理', text: '可以查看生效关系、调整个人提醒线或撤销；任一方撤销后立即停止新旧事件投影。' },
    ],
    safety: '家庭操作使用独立 6 位操作码；先到账号设置创建，不需要交易密码。',
  },
  security: {
    eyebrow: '页面导览',
    title: '安全中心：资金核验的双保险',
    intro: '交易密码和设备验证共同保护所有资金写操作。没有设备时会明确阻断，不会降级成仅密码通过。',
    sections: [
      { title: '交易密码', text: '8–64 位，至少包含字母和数字；不要使用真实银行卡密码，也不要发到聊天。' },
      { title: '设备绑定', text: '浏览器调用 WebAuthn，由系统完成指纹、人脸、PIN 或通行密钥验证，应用不读取生物特征。' },
      { title: '连续错误', text: '密码或操作码连续输错会临时锁定；重置沙箱不会清除安全设置。' },
    ],
    safety: '设备验证需要通过 http://localhost:8787 访问，127.0.0.1 是另一个账户范围。',
  },
  settings: {
    eyebrow: '页面导览',
    title: '账号设置：把两类密码分开',
    intro: '这里设置独立的 6 位操作码，用于家庭提醒等非资金设置。资金操作仍走安全中心的交易密码和设备验证。',
    sections: [
      { title: '操作码', text: '操作码输入更频繁，适合家庭邀请、加入、撤销和提醒线更新；不参与转账或申赎。' },
      { title: '修改', text: '修改操作码需要先输入当前操作码；连续输错 5 次会锁定 10 分钟。' },
      { title: '资金安全', text: '设置或修改操作码不会改变资金核验策略，也不会绕过设备验证。' },
    ],
    safety: '请勿把操作码设成交易密码、银行卡密码或生日。',
  },
};

interface PageGuideProps {
  route: Route;
  onClose: () => void;
}

export function PageGuide({ route, onClose }: PageGuideProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const guide = PAGE_GUIDES[route];

  useEffect(() => {
    document.body.classList.add('dialog-open');
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('dialog-open');
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  if (!guide) return null;

  return (
    <div className="guide-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="guide-head">
          <span className="guide-mark"><BookOpen size={20} /></span>
          <div>
            <span className="guide-eyebrow">{guide.eyebrow}</span>
            <h2 id={titleId}>{guide.title}</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button guide-close" aria-label="关闭页面导览" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <p className="guide-intro">{guide.intro}</p>

        <div className="guide-sections">
          {guide.sections.map((section, index) => (
            <article key={section.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{section.title}</h3>
                <p>{section.text}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="guide-safety">
          <ShieldCheck size={17} />
          <p>{guide.safety}</p>
        </div>

        <footer className="guide-foot">
          <p>之后可以点右上角的导览按钮再次查看。</p>
          <button className="button button--primary" type="button" onClick={onClose}>
            开始使用 <ArrowRight size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}
