"""
Seed MongoDB with sample data.

Collections:
    - owners
    - inventory
    - suppliers
    - agent_actions

There is NO staff collection.
"""

import asyncio
import json
import os

from database.mongodb import (
    owners_collection,
    inventory_collection,
    suppliers_collection,
    agent_actions_collection,
    ping_database,
    create_indexes
)


# ============================================================
# SAMPLE DATA PATH
# ============================================================

SAMPLE_DATA_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "data",
        "sample_data.json"
    )
)


# ============================================================
# NORMALIZATION
# ============================================================

def normalize_owner(owner):
    """
    Keep exactly the required owner fields.
    """

    return {
        "owner_id": owner.get("owner_id"),
        "owner_email": owner.get("owner_email"),
        "owner_password": owner.get("owner_password"),
        "owner_name": owner.get("owner_name"),
        "business_name": owner.get("business_name")
    }


def normalize_inventory(item):
    """
    Keep exactly the required inventory fields.
    """

    return {
        "owner_id": item.get("owner_id"),
        "item_id": item.get("item_id"),
        "item_name": item.get("item_name"),
        "current_stock": item.get("current_stock"),
        "status": item.get("status")
    }


def normalize_supplier(supplier):
    """
    Keep exactly the required supplier fields.
    """

    return {
        "owner_id": supplier.get("owner_id"),
        "supplier_id": supplier.get("supplier_id"),
        "supplier_name": supplier.get("supplier_name"),
        "supplier_email": supplier.get("supplier_email"),
        "phone_number": supplier.get("phone_number"),
        "items sold": supplier.get("items sold", [])
    }


# ============================================================
# VALIDATION
# ============================================================

def validate_owner(owner):

    required_fields = [
        "owner_id",
        "owner_email",
        "owner_password",
        "owner_name",
        "business_name"
    ]

    for field in required_fields:

        if owner.get(field) is None:

            raise ValueError(
                f"Owner is missing required field: {field}"
            )


def validate_inventory(item):

    required_fields = [
        "owner_id",
        "item_id",
        "item_name",
        "current_stock",
        "status"
    ]

    for field in required_fields:

        if item.get(field) is None:

            raise ValueError(
                f"Inventory item is missing required field: {field}"
            )


def validate_supplier(supplier):

    required_fields = [
        "owner_id",
        "supplier_id",
        "supplier_name",
        "supplier_email",
        "phone_number",
        "items sold"
    ]

    for field in required_fields:

        if supplier.get(field) is None:

            raise ValueError(
                f"Supplier is missing required field: {field}"
            )


# ============================================================
# SEED DATABASE
# ============================================================

async def seed():

    # ========================================================
    # 1. CHECK DATABASE
    # ========================================================

    connected = await ping_database()

    if not connected:

        print("❌ MongoDB connection failed.")
        print("❌ Check your .env file.")

        return


    # ========================================================
    # 2. LOAD SAMPLE DATA
    # ========================================================

    print("📂 Loading sample data...")

    if not os.path.exists(SAMPLE_DATA_PATH):

        print("❌ sample_data.json not found.")

        print(
            f"Expected location:\n{SAMPLE_DATA_PATH}"
        )

        return


    with open(
        SAMPLE_DATA_PATH,
        "r",
        encoding="utf-8"
    ) as file:

        data = json.load(file)


    print("✅ Sample data loaded")


    # ========================================================
    # 3. CLEAN OLD INDEXES
    # ========================================================
    #
    # IMPORTANT:
    # This must happen BEFORE inserting data.
    #
    # Your Atlas database previously contained an old
    # unique index on:
    #
    #     email
    #
    # while the new schema uses:
    #
    #     owner_email
    #
    # create_indexes() removes the old indexes and creates
    # the correct indexes.
    #
    # ========================================================

    print("🧹 Cleaning old indexes...")

    await create_indexes()

    print("✅ Indexes cleaned and recreated")


    # ========================================================
    # 4. CLEAR EXISTING DATA
    # ========================================================

    print("🧹 Clearing existing data...")

    await owners_collection.delete_many({})

    await inventory_collection.delete_many({})

    await suppliers_collection.delete_many({})

    await agent_actions_collection.delete_many({})

    print("✅ Existing data cleared")


    # ========================================================
    # 5. OWNERS
    # ========================================================

    owners = [
        normalize_owner(owner)
        for owner in data.get("owners", [])
    ]

    for owner in owners:

        validate_owner(owner)


    if owners:

        await owners_collection.insert_many(
            owners
        )

        print(
            f"✅ Inserted {len(owners)} owners"
        )

    else:

        print(
            "ℹ️ No owners to insert"
        )


    # ========================================================
    # 6. INVENTORY
    # ========================================================

    inventory = [
        normalize_inventory(item)
        for item in data.get("inventory", [])
    ]

    for item in inventory:

        validate_inventory(item)


    if inventory:

        await inventory_collection.insert_many(
            inventory
        )

        print(
            f"✅ Inserted {len(inventory)} inventory items"
        )

    else:

        print(
            "ℹ️ No inventory items to insert"
        )


    # ========================================================
    # 7. SUPPLIERS
    # ========================================================

    suppliers = [
        normalize_supplier(supplier)
        for supplier in data.get("suppliers", [])
    ]

    for supplier in suppliers:

        validate_supplier(supplier)


    if suppliers:

        await suppliers_collection.insert_many(
            suppliers
        )

        print(
            f"✅ Inserted {len(suppliers)} suppliers"
        )

    else:

        print(
            "ℹ️ No suppliers to insert"
        )


    # ========================================================
    # 8. STAFF
    # ========================================================

    print(
        "ℹ️ Staff collection removed — skipping staff data"
    )


    # ========================================================
    # 9. AGENT ACTIONS
    # ========================================================

    agent_actions = data.get(
        "agent_actions",
        []
    )


    if agent_actions:

        await agent_actions_collection.insert_many(
            agent_actions
        )

        print(
            f"✅ Inserted {len(agent_actions)} agent actions"
        )

    else:

        print(
            "ℹ️ No agent actions to insert"
        )


    # ========================================================
    # 10. COMPLETE
    # ========================================================

    print("")
    print("🎉 SEEDING COMPLETE")
    print("")
    print("Collections:")
    print("  ✅ owners")
    print("  ✅ inventory")
    print("  ✅ suppliers")
    print("  ✅ agent_actions")
    print("  ❌ staff — removed")
    print("")


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    asyncio.run(seed())