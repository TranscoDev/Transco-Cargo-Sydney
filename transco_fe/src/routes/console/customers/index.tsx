import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ContactsDirectory } from "@/components/transco/contacts-directory";
import { useConversations } from "@/lib/transco/store";

// Unchanged from the old /console "contacts" tab — same component,
// same data/handlers, same search/filter/segments/CSV/import
// behavior. Only the nav label moved to "Customers" (CRM section) and
// selecting a conversation now navigates to the /conversations route
// instead of flipping local tab state.
export const Route = createFileRoute("/console/customers/")({
  component: CustomersPage,
});

function CustomersPage() {
  const navigate = useNavigate();
  const {
    conversations,
    selectConversation,
    updateContact,
    updateStatus,
    addContact,
    sendEmailCampaign,
    segments,
    saveSegment,
    deleteSegment,
    importCustomers,
  } = useConversations();

  return (
    <ContactsDirectory
      conversations={conversations}
      onSelect={(id) => {
        selectConversation(id);
        void navigate({ to: "/console/conversations" });
      }}
      onUpdateContact={updateContact}
      onUpdateStatus={updateStatus}
      onAddContact={addContact}
      onSendEmailCampaign={sendEmailCampaign}
      segments={segments}
      onSaveSegment={saveSegment}
      onDeleteSegment={deleteSegment}
      onImportCustomers={importCustomers}
    />
  );
}
