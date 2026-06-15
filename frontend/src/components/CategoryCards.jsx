import { scoreTier, scoreColor } from '../lib/format';

const CATEGORIES = [
  { key: 'security', label: 'Security', icon: '🛡️' },
  { key: 'complexity', label: 'Complexity', icon: '🧩' },
  { key: 'maintainability', label: 'Maintainability', icon: '🔧' },
  { key: 'documentation', label: 'Documentation', icon: '📘' },
];

function CategoryCards({ scores }) {
  return (
    <div className="category-grid">
      {CATEGORIES.map(({ key, label, icon }) => {
        const raw = scores?.[key] ?? 0;
        const score = Math.round(Number(raw) || 0);
        const tier = scoreTier(score);
        return (
          <div className={`category-card tier-${tier}`} key={key}>
            <div className="category-card-head">
              <span className="category-icon" aria-hidden="true">{icon}</span>
              <span className="category-name">{label}</span>
            </div>
            <div className="category-score">
              {score}
              <span className="category-score-max">/100</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${score}%`, background: scoreColor(score) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CategoryCards;
