"""
MongoDB connection module.

Collections:
    - owners
    - inventory
    - suppliers
    - agent_actions

There is NO staff collection.

MongoDB connection is taken from:
    backend/.env

Required environment variables:
    MONGODB_URI
    DB_NAME
"""

import os

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv


# ============================================================
# ENVIRONMENT
# ============================================================

# Always load the .env file located in the backend folder.
# This makes the application independent of the terminal's
# current working directory.

BASE_DIR = os.path.dirname(
    os.path.dirname(
        os.path.abspath(__file__)
    )
)

ENV_FILE = os.path.join(
    BASE_DIR,
    ".env"
)

load_dotenv(ENV_FILE)


# ============================================================
# MONGODB CONFIGURATION
# ============================================================

MONGODB_URI = os.getenv("MONGODB_URI")

DB_NAME = os.getenv(
    "DB_NAME",
    "business_agent"
)


if not MONGODB_URI:
    raise ValueError(
        "MONGODB_URI is not set in backend/.env"
    )


# ============================================================
# DATABASE CONNECTION
# ============================================================

client = AsyncIOMotorClient(
    MONGODB_URI
)

db = client[
    DB_NAME
]


# ============================================================
# COLLECTIONS
# ============================================================

owners_collection = db[
    "owners"
]

inventory_collection = db[
    "inventory"
]

suppliers_collection = db[
    "suppliers"
]

agent_actions_collection = db[
    "agent_actions"
]


# ============================================================
# DATABASE PING
# ============================================================

async def ping_database():
    """
    Check whether MongoDB Atlas is reachable.
    """

    try:

        await client.admin.command(
            "ping"
        )

        print(
            f"✅ MongoDB connected — database: '{DB_NAME}'"
        )

        return True

    except Exception as e:

        print(
            f"❌ MongoDB connection failed: {e}"
        )

        return False


# ============================================================
# INDEX CREATION
# ============================================================

async def create_indexes():
    """
    Remove old indexes and create the correct
    indexes for the current database structure.

    This prevents conflicts with indexes created
    by older versions of the project.
    """

    print("🧹 Removing old indexes...")

    collections = [
        owners_collection,
        inventory_collection,
        suppliers_collection,
        agent_actions_collection
    ]


    # ========================================================
    # REMOVE OLD INDEXES
    # ========================================================

    for collection in collections:

        try:

            await collection.drop_indexes()

            print(
                f"✅ Cleared indexes: {collection.name}"
            )

        except Exception as e:

            print(
                f"⚠️ Could not clear indexes from "
                f"{collection.name}: {e}"
            )


    print("🔨 Creating MongoDB indexes...")


    # ========================================================
    # OWNERS
    #
    # Fields:
    # owner_id
    # owner_email
    # owner_password
    # owner_name
    # business_name
    # ========================================================

    await owners_collection.create_index(
        [
            ("owner_id", 1)
        ],
        unique=True,
        name="unique_owner_id"
    )

    await owners_collection.create_index(
        [
            ("owner_email", 1)
        ],
        unique=True,
        name="unique_owner_email"
    )

    print(
        "✅ Owners indexes created"
    )


    # ========================================================
    # INVENTORY
    #
    # Fields:
    # owner_id
    # item_id
    # item_name
    # current_stock
    # status
    #
    # owner_id + item_id must be unique together.
    # ========================================================

    await inventory_collection.create_index(
        [
            ("owner_id", 1),
            ("item_id", 1)
        ],
        unique=True,
        name="unique_owner_item"
    )

    print(
        "✅ Inventory indexes created"
    )


    # ========================================================
    # SUPPLIERS
    #
    # Fields:
    # owner_id
    # supplier_id
    # supplier_name
    # supplier_email
    # phone_number
    # items sold
    #
    # owner_id + supplier_id must be unique together.
    # ========================================================

    await suppliers_collection.create_index(
        [
            ("owner_id", 1),
            ("supplier_id", 1)
        ],
        unique=True,
        name="unique_owner_supplier"
    )

    print(
        "✅ Suppliers indexes created"
    )


    # ========================================================
    # AGENT ACTIONS
    #
    # Agent actions remain separate from the main
    # business collections.
    # ========================================================

    await agent_actions_collection.create_index(
        [
            ("owner_id", 1),
            ("action_id", 1)
        ],
        unique=True,
        name="unique_owner_action"
    )

    await agent_actions_collection.create_index(
        [
            ("owner_id", 1),
            ("status", 1)
        ],
        name="owner_action_status"
    )

    print(
        "✅ Agent actions indexes created"
    )


    # ========================================================
    # COMPLETE
    # ========================================================

    print("")
    print(
        "🎯 All MongoDB indexes created successfully"
    )