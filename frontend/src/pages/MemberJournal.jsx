import { useNavigate } from "react-router-dom";
import TradeJournalModal from "@/components/TradeJournalModal";

export default function MemberJournal() {
  const navigate = useNavigate();

  return (
    <TradeJournalModal
      open
      memberMode
      onOpenChange={(isOpen) => {
        if (!isOpen) navigate("/account");
      }}
    />
  );
}
