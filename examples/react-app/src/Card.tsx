import { useState } from 'react';

export function Card() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ border: '1px solid black' }}>
      Host element
      <button onClick={() => setCount((current) => current + 1)}>Count: {count}</button>
    </div>
  );
}
