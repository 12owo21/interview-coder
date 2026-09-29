import { BookOpen } from 'lucide-react'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { platformAlt } from '@/lib/utils/env'
import { HelpSection } from './components'

const faqs = [
  {
    question: '如何截取屏幕截图？',
    answer: (
      <span>
        按下
        <ShortcutRenderer shortcut={`${platformAlt}+Enter`} className="text-xs mx-1" />
        快捷键即可截取当前屏幕的截图。截图会自动显示在应用中。
      </span>
    )
  },
  {
    question: '如何处理题目超过一屏的情况？',
    answer: (
      <span>
        按下
        <ShortcutRenderer shortcut={`${platformAlt}+Shift+Enter`} className="text-xs mx-1" />
        快捷键即可在当前对话中追加截图并生成解题建议。
      </span>
    )
  },
  {
    question: '接了多个显示器，截到的不是题目所在的屏幕？',
    answer: (
      <span>
        默认截取鼠标所在的屏幕，截图前把鼠标移到题目所在的屏幕即可。如果用悬浮工具条截图（点按钮时鼠标在工具条所在的屏幕），或者题目总在同一块屏幕上，可在「设置
        → 截图模式 → 截图屏幕」中指定固定的屏幕。
      </span>
    )
  },
  {
    question: '只想截屏幕上的一块区域（比如题干）？',
    answer: (
      <span>
        在「设置 → 截图模式 → 截图区域」中点「框选区域」，也可以点悬浮工具条上的框选按钮，或按下
        <ShortcutRenderer shortcut={`${platformAlt}+Shift+R`} className="text-xs mx-1" />
        。在定格的屏幕画面上拖出要截的范围，按 Enter
        或双击确认。之后每次截图（包括追加截图）都只截这块区域，AI
        看得更准、响应也更快；题目位置变了随时重新框选，在设置里点「恢复整屏」即可取消。
        注意：框选时本工具会暂时获得焦点，考试页面可能检测到切出，建议在开考前框好。
      </span>
    )
  },
  {
    question: '分享屏幕时，对方能看到应用吗？',
    answer: (
      <span>
        工具窗口在共享屏幕时自动隐藏(对方不可见)，但小部分会议软件可能需要配置才能隐藏。所以如果你对隐身功能有需求，务必在正式使用前用「当前电脑」+「当前会议软件」测试一下。更多细节请参考{' '}
        <a
          href="https://github.com/ooboqoo/interview-coder-cn/wiki/隐身配置"
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:underline"
        >
          GitHub Wiki
        </a>
        。
      </span>
    )
  },
  {
    question: '鼠标移过窗口时，光标会不会变？',
    answer: (
      <span>
        本工具提供了开关，可以开启或关闭鼠标穿透。开启鼠标穿透时，窗口对鼠标隐身，你需要通过快捷键来操作窗口。切换「鼠标穿透」开关的快捷键是{' '}
        <ShortcutRenderer shortcut={`${platformAlt}+M`} className="text-xs" />{' '}
        。窗口右下角会显示当前状态。
      </span>
    )
  },
  {
    question: '不想用快捷键，可以用鼠标操作吗？',
    answer: (
      <span>
        可以。主窗口上方的「悬浮工具条」把常用操作做成了按钮，点击即可，且不会让做题页面失焦。
        工具条可在「设置 → 界面与隐私 →
        悬浮工具条」中开启或关闭，各按钮的含义见上方「悬浮工具条」章节。
      </span>
    )
  },
  {
    question: '语音转录功能是什么？如何使用？',
    answer: (
      <span>
        语音转录功能可以实时将面试官的语音或题目朗读转为文字，辅助 AI
        更好地理解题意。使用前需在「设置 → 语音」中配置百炼平台 API Key，然后按下
        <ShortcutRenderer shortcut={`${platformAlt}+T`} className="text-xs mx-1" />
        开始/暂停转录。转录文本会在截图时自动附带提交给 AI。
      </span>
    )
  },
  {
    question: '转录的文本可以单独清除吗？',
    answer: (
      <span>
        可以。按下
        <ShortcutRenderer shortcut={`${platformAlt}+Shift+T`} className="text-xs mx-1" />
        即可清除当前转录文本，清除后的文本不会提交给 AI。截图时也会自动清除已有转录文本。
      </span>
    )
  }
]

export function FAQ() {
  return (
    <HelpSection Icon={BookOpen} title="常见问题">
      {faqs.map((faq, index) => (
        <div key={index} className="border border-gray-400 rounded-lg p-4">
          <h3 className="font-semibold mb-2">{faq.question}</h3>
          <p className="text-sm text-gray-700">{faq.answer}</p>
        </div>
      ))}
    </HelpSection>
  )
}
