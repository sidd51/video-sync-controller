import { useParams } from "react-router-dom";

function DisplayPage() {
  const { displayId } = useParams();

  return (
    <main>
      <h1>Display Client</h1>
      <p>Display ID: {displayId}</p>
    </main>
  );
}

export default DisplayPage;