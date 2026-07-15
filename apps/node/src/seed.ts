import type { UserRole } from "@wejoy/domain";
import type { Database } from "./database.js";
import { createPasswordRecord } from "./auth.js";

const DEMO_PASSWORD = "demo1234";

interface SeedUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
}

const users: SeedUser[] = [
  {
    id: "usr_demo_consumer",
    username: "demo.consumer",
    role: "consumer",
    displayName: "林小满"
  },
  {
    id: "usr_demo_merchant_noodles",
    username: "demo.noodles",
    role: "merchant",
    displayName: "禾喜面馆"
  },
  {
    id: "usr_demo_merchant_dumplings",
    username: "demo.dumplings",
    role: "merchant",
    displayName: "邻里饺子铺"
  },
  {
    id: "usr_demo_rider",
    username: "demo.rider",
    role: "rider",
    displayName: "周师傅"
  },
  {
    id: "usr_demo_rider_two",
    username: "demo.rider2",
    role: "rider",
    displayName: "陈师傅"
  },
  {
    id: "usr_demo_operator",
    username: "demo.operator",
    role: "operator",
    displayName: "社区节点"
  }
];

export function seedDemoData(database: Database): void {
  const existing = database.sqlite
    .prepare("SELECT id FROM users WHERE username = 'demo.consumer'")
    .get();
  if (existing) {
    return;
  }

  const now = new Date().toISOString();
  database.transaction(() => {
    for (const user of users) {
      const password = createPasswordRecord(DEMO_PASSWORD);
      database.sqlite
        .prepare(
          `INSERT INTO users
            (id, username, password_hash, password_salt, role, display_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          user.id,
          user.username,
          password.hash,
          password.salt,
          user.role,
          user.displayName,
          now
        );
    }

    database.sqlite.exec(`
      INSERT INTO merchants
        (user_id, name, description, address, prep_minutes, is_open)
      VALUES
        ('usr_demo_merchant_noodles', '禾喜面馆', '手擀面、现熬汤，食材账目向社区公开。', '青禾路 18 号', 18, 1),
        ('usr_demo_merchant_dumplings', '邻里饺子铺', '每日现包，晚餐时段供应。', '木棉街 6 号', 22, 1);

      INSERT INTO riders
        (user_id, minimum_fee_fen, is_available, transport, completed_deliveries)
      VALUES
        ('usr_demo_rider', 600, 1, 'ebike', 128),
        ('usr_demo_rider_two', 700, 1, 'bike', 74);

      INSERT INTO menu_items
        (id, merchant_id, name, description, category, price_fen, is_available, sort_order)
      VALUES
        ('menu_beef_noodles', 'usr_demo_merchant_noodles', '清炖牛肉面', '牛腱、白萝卜、手擀面', '招牌面', 2600, 1, 1),
        ('menu_tomato_noodles', 'usr_demo_merchant_noodles', '番茄鸡蛋面', '熟番茄汤底、走地鸡蛋', '招牌面', 1800, 1, 2),
        ('menu_cucumber', 'usr_demo_merchant_noodles', '拍黄瓜', '蒜香陈醋汁', '小菜', 800, 1, 3),
        ('menu_pork_dumplings', 'usr_demo_merchant_dumplings', '猪肉白菜水饺', '12 只，手工现包', '水饺', 2200, 1, 1),
        ('menu_mushroom_dumplings', 'usr_demo_merchant_dumplings', '香菇青菜水饺', '12 只，素食', '水饺', 2000, 1, 2),
        ('menu_seaweed_soup', 'usr_demo_merchant_dumplings', '紫菜蛋花汤', '清汤、紫菜、鸡蛋', '汤品', 600, 1, 3);
    `);
  });
}

export const demoAccounts = users.map((user) => ({
  username: user.username,
  password: DEMO_PASSWORD,
  role: user.role,
  displayName: user.displayName
}));
