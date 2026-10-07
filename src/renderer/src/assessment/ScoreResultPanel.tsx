import type { AssessmentScoringResult } from '../../../shared/assessment-scoring'

export function ScoreResultPanel({ scoring }: { scoring: AssessmentScoringResult }) {
  return (
    <section className="mt-4 overflow-x-auto rounded-md bg-black/10 p-3 text-xs">
      <h2 className="mb-2 text-sm font-medium">本题选项评分</h2>
      <table className="w-full text-left">
        <thead>
          <tr>
            <th className="p-1">选项</th>
            <th className="p-1">内容</th>
            <th className="p-1">分数</th>
            <th className="p-1">来源</th>
            <th className="p-1">操作</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(scoring.options).map(([answer, item]) => (
            <tr key={answer} className="border-t border-app-border">
              <td className="p-1">{answer}</td>
              <td className="p-1">{item.text}</td>
              <td className="p-1 tabular-nums">{item.score}</td>
              <td className="whitespace-nowrap p-1">
                {item.source === 'history' ? '历史评分' : '本轮评分'}
              </td>
              <td className="whitespace-nowrap p-1">
                {answer === scoring.most
                  ? '① 最符合'
                  : answer === scoring.least
                    ? '② 最不符合'
                    : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
