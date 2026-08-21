import {
  BoxSelect,
  Check,
  CircleAlert,
  Code2,
  Cookie,
  FileArchive,
  Globe2,
  HardDrive,
  Network,
  Play,
  ShieldCheck,
  TerminalSquare,
  Video,
} from "lucide-react"
import { Brand } from "../../components/Brand"

const evidence = [
  { icon: Globe2, title: "页面与环境", description: "URL、标题、viewport、DPR、浏览器和语言。" },
  { icon: BoxSelect, title: "目标元素", description: "DOM 摘要、关键样式、CSS 规则、Selector 与 React 提示。" },
  { icon: TerminalSquare, title: "控制台", description: "开始采集后的日志、页面错误和未处理 Promise rejection。" },
  { icon: Network, title: "网络", description: "fetch、XHR、资源状态、耗时和脱敏正文预览。" },
  { icon: Video, title: "可选整屏录屏", description: "1280 × 720 无音频 WebM，以及最多 24 个关键帧时间点。" },
]

const steps = [
  ["开始采集", "点击“开始标注”或“录制页面”即可开始。"],
  ["复现问题", "回到网页重新触发问题，确保相关日志和请求发生在采集窗口内。"],
  ["选择并标注", "使用右下角工具条点击关键元素，就地填写实际表现与期望结果；按 Escape 可退出。"],
  ["继续采集", "保存后继续选择，也可以点击编号重编辑，或使用撤销和清空。"],
  ["保存位置", "默认写入 Chrome 下载目录下的 Rootline 文件夹，也可以在 Popup 切换到远程并打开独立窗口配置腾讯云 COS 或阿里云 OSS。"],
  ["交给 AI", "本地模式复制本地路径；远程模式复制已经生成的对象存储报告链接，不会重复上传。"],
]

export function InstructionsApp() {
  return (
    <main className="instructions-shell">
      <header className="instructions-header">
        <div className="instructions-inner">
          <Brand />
          <p className="instructions-kicker">浏览器运行态采集工具</p>
          <h1>从页面问题到可执行改动计划</h1>
          <p className="instructions-lead">采集运行态证据，核对问题目标，再把完整上下文交给当前项目中的 Codex、Claude 或 Cursor。</p>
        </div>
      </header>

      <div className="instructions-inner instructions-content">
        <aside className="instructions-callout">
          <CircleAlert aria-hidden="true" size={20} />
          <div><h2>先开始采集，再复现问题</h2><p>控制台和网络证据只覆盖用户主动开始采集后的时间窗口。</p></div>
        </aside>

        <section aria-labelledby="workflow-title" className="instructions-section">
          <SectionHeading eyebrow="Workflow" id="workflow-title" title="完整采集流程" />
          <ol className="workflow-steps">
            {steps.map(([title, description], index) => (
              <li key={title}>
                <span>{index + 1}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="evidence-title" className="instructions-section">
          <SectionHeading eyebrow="Evidence" id="evidence-title" title="报告包含什么" />
          <div className="evidence-guide">
            {evidence.map(({ description, icon: Icon, title }) => (
              <article key={title}><Icon aria-hidden="true" size={19} /><h3>{title}</h3><p>{description}</p></article>
            ))}
          </div>
        </section>

        <section aria-labelledby="privacy-title" className="instructions-section">
          <SectionHeading eyebrow="Privacy" id="privacy-title" title="本地 / 远程保存与采集边界" />
          <div className="privacy-grid">
            <article>
              <ShieldCheck aria-hidden="true" size={20} />
              <div><h3>进入存储前脱敏</h3><p>敏感 Header、Query、JSON 与表单字段会被隐藏，内容还会按固定上限截断。</p></div>
            </article>
            <article>
              <HardDrive aria-hidden="true" size={20} />
              <div><h3>本地或远程保存</h3><p>本地模式写入 Downloads/Rootline；远程模式直接写入你自己的腾讯云 COS 或阿里云 OSS。推荐“公有读、私有写”，不要使用公有读写。请关闭对象存储的“强制下载/下载文件”设置，否则 report.html 会被浏览器直接下载；CORS 建议暴露 Content-Disposition、Content-Type、Content-Length、ETag。</p></div>
            </article>
            <article>
              <Cookie aria-hidden="true" size={20} />
              <div><h3>明确不采集</h3><p>Cookie、LocalStorage、SessionStorage、密码、完整页面 HTML 与浏览历史不进入报告。</p></div>
            </article>
          </div>
        </section>

        <section aria-labelledby="output-title" className="instructions-section">
          <SectionHeading eyebrow="Output" id="output-title" title="本地或远程输出" />
          <div className="output-row">
            <FileArchive aria-hidden="true" size={22} />
            <div><h3>rootline-capture-YYYY-MM-DD_HH-mm-ss-&lt;id&gt;</h3><p><span className="rl-mono">report.md</span>、<span className="rl-mono">report.json</span>、<span className="rl-mono">capture.png</span>，录屏采集另含 <span className="rl-mono">capture.webm</span></p></div>
          </div>
          <ul className="tip-list">
            <li><Check aria-hidden="true" size={16} /><span>复制上下文前先写清问题现象和正确行为，不要预设根因。</span></li>
            <li><Check aria-hidden="true" size={16} /><span>接口问题应在采集启动后重新触发请求。</span></li>
            <li><Check aria-hidden="true" size={16} /><span>录屏不包含任何音频，达到内部时长上限后会自动停止。</span></li>
            <li><Check aria-hidden="true" size={16} /><span>Chrome 内部页、商店页、PDF、跨域 iframe 和 closed shadow root 受浏览器权限限制。</span></li>
          </ul>
        </section>

        <footer className="instructions-footer">
          <Play aria-hidden="true" size={16} /><span>Rootline 不调用模型，也不会向 Rootline 服务器上传数据；远程模式只写入你自己的对象存储。</span><Code2 aria-hidden="true" size={16} />
        </footer>
      </div>
    </main>
  )
}

function SectionHeading({ eyebrow, id, title }: { eyebrow: string; id: string; title: string }) {
  return <div className="section-heading"><p>{eyebrow}</p><h2 id={id}>{title}</h2></div>
}
