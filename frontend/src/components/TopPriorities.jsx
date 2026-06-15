function TopPriorities({ priorities = [] }) {
  if (!priorities.length) return null;

  return (
    <section className="section top-priorities">
      <h2 className="section-title">What to fix first</h2>
      <ol className="priority-list">
        {priorities.map((text, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <li className="priority-item" key={i}>
            <span className="priority-number">{i + 1}</span>
            <span className="priority-text">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default TopPriorities;
