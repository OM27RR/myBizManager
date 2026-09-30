from datetime import datetime, date, timezone
from enum import Enum
from typing import Optional, Any, Union
from pydantic import BaseModel, Field, field_validator, model_validator


def utc_now() -> datetime:
    """Timezone-aware UTC now — replaces the deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc)


# ============================================================================
# 1. INVENTORY
# ============================================================================

class InventoryItem(BaseModel):
    item_id: str
    name: Optional[str] = None
    item_name: Optional[str] = None  # alias support for schema flexibility
    category: Optional[str] = "General"
    unit: str = "kg"  # kg, litre, unit, packet
    current_stock: float = Field(ge=0)
    reorder_threshold: Optional[float] = Field(default=0.0, ge=0)
    safety_stock_level: float = Field(default=0.0, ge=0)
    avg_daily_usage: Optional[float] = Field(default=0.0, ge=0)
    cost_per_unit: Optional[float] = Field(default=0.0, ge=0)
    status: Optional[str] = "In Stock"
    last_updated: Any = Field(default_factory=utc_now)

    @field_validator("name", mode="before")
    @classmethod
    def fallback_name(cls, v: Any, info: Any) -> Any:
        return v

    @field_validator("last_updated", mode="before")
    @classmethod
    def parse_last_updated(cls, v: Any) -> Any:
        if isinstance(v, (int, float)):
            # convert epoch timestamp safely to ISO datetime
            return datetime.fromtimestamp(v, tz=timezone.utc)
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v)
            except Exception:
                return v
        return v or utc_now()


# ============================================================================
# 2. ORDERS
# ============================================================================

class OrderStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class OrderItem(BaseModel):
    item_id: str
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)

class Order(BaseModel):
    order_id: str
    customer_id: str
    items: list[OrderItem]
    total_amount: float = Field(ge=0)
    status: OrderStatus = OrderStatus.PENDING
    timestamp: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def check_total_matches_items(self) -> "Order":
        computed = sum(item.quantity * item.unit_price for item in self.items)
        # small tolerance for float rounding
        if abs(computed - self.total_amount) > 0.01:
            raise ValueError(
                f"total_amount ({self.total_amount}) does not match "
                f"sum of items ({computed:.2f})"
            )
        return self


# ============================================================================
# 3. SUPPLIERS & CANDIDATE OPTIONS (Dynamic Supplier Selection)
# ============================================================================

class PriceHistory(BaseModel):
    item_id: str
    price: float = Field(ge=0)
    recorded_at: datetime = Field(default_factory=utc_now)

class SupplierCandidate(BaseModel):
    supplier_id: str
    name: str
    email: Optional[str] = None
    contact_phone: Optional[str] = None
    current_price: Optional[float] = None
    unit_price: Optional[float] = None
    lead_time_days: Optional[int] = None
    reliability_score: Optional[float] = None
    moq: Optional[float] = None
    is_recommended: bool = False
    comparison_note: Optional[str] = None

class Supplier(BaseModel):
    supplier_id: str
    name: str
    contact_email: str
    contact_phone: Optional[str] = None
    item_catalog: list[str] = Field(default_factory=list)  # list of item_ids supplied
    price_history: list[PriceHistory] = Field(default_factory=list)
    lead_time_days: int = Field(default=2, ge=0)
    reliability_score: float = Field(default=0.95, ge=0.0, le=1.0, description="SLA fulfillment rate from 0.0 to 1.0")


# ============================================================================
# 4. STAFF
# ============================================================================

class AttendanceStatus(str, Enum):
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    ON_LEAVE = "on_leave"

class ShiftSchedule(BaseModel):
    date: date
    start_time: str  # e.g., "09:00"
    end_time: str    # e.g., "17:00"

class AttendanceLog(BaseModel):
    date: date
    status: AttendanceStatus
    check_in_time: Optional[datetime] = None

class Staff(BaseModel):
    staff_id: str
    name: str
    role: str
    phone: Optional[str] = None
    shift_schedule: list[ShiftSchedule] = Field(default_factory=list)
    attendance_log: list[AttendanceLog] = Field(default_factory=list)


# ============================================================================
# 5. CUSTOMERS
# ============================================================================

class Customer(BaseModel):
    customer_id: str
    name: Optional[str] = None
    phone: Optional[str] = None
    order_history: list[str] = Field(default_factory=list)
    last_visit: Optional[datetime] = None
    loyalty_score: float = 0.0


# ============================================================================
# 6. INVOICES
# ============================================================================

class InvoiceStatus(str, Enum):
    PAID = "paid"
    PENDING = "pending"
    OVERDUE = "overdue"

class InvoiceParty(str, Enum):
    VENDOR = "vendor"
    CUSTOMER = "customer"

class Invoice(BaseModel):
    invoice_id: str
    party_type: InvoiceParty
    party_id: str
    amount: float = Field(ge=0)
    due_date: date
    status: InvoiceStatus = InvoiceStatus.PENDING
    created_at: datetime = Field(default_factory=utc_now)


# ============================================================================
# 7. AGENT ACTIONS, RECOMMENDATIONS & DYNAMIC SELECTION
# ============================================================================

class OwnerDecision(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    MODIFIED = "modified"

class ActionStatus(str, Enum):
    AWAITING_APPROVAL = "awaiting_approval"
    EXECUTED = "executed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class RecommendationPayload(BaseModel):
    supplier_id: str
    supplier_name: Optional[str] = None
    qty: float
    justification: str
    risk_notes: Optional[str] = None
    candidate_suppliers: list[SupplierCandidate] = Field(default_factory=list)

class AgentAction(BaseModel):
    action_id: str
    thread_id: Optional[str] = None
    type: str  # e.g., "purchase_recommendation", "inventory_restock"
    trigger_reason: str
    recommendation: Union[str, dict[str, Any], RecommendationPayload]
    candidate_suppliers: list[SupplierCandidate] = Field(default_factory=list)
    selected_supplier_id: Optional[str] = None
    proposed_payload: dict[str, Any] = Field(default_factory=dict)
    owner_decision: OwnerDecision = OwnerDecision.PENDING
    owner_feedback: Optional[str] = None
    modified_payload: Optional[dict[str, Any]] = None
    status: ActionStatus = ActionStatus.AWAITING_APPROVAL
    timestamp: datetime = Field(default_factory=utc_now)


# ============================================================================
# 8. API REQUEST / RESPONSE SCHEMAS
# ============================================================================

class ApproveRecommendationRequest(BaseModel):
    decision: OwnerDecision = OwnerDecision.APPROVED
    selected_supplier_id: Optional[str] = None  # Supplier picked dynamically by user
    supplier_id: Optional[str] = None          # Alternative field name
    qty: Optional[float] = None
    reason: Optional[str] = None

class DraftEmailRequest(BaseModel):
    action_id: Optional[str] = None
    item_id: str
    selected_supplier_id: str
    order_qty: float
    notes: Optional[str] = None