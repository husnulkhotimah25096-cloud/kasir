/*
  Warnings:

  - A unique constraint covering the columns `[productVariantId,warehouseId]` on the table `Stock` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Made the column `warehouseId` on table `stock` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `username` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `stock` DROP FOREIGN KEY `Stock_warehouseId_fkey`;

-- DropIndex
DROP INDEX `Stock_productVariantId_key` ON `stock`;

-- DropIndex
DROP INDEX `TopProductAggr_storeId_totalSold_idx` ON `topproductaggr`;

-- AlterTable
ALTER TABLE `order` ADD COLUMN `channel` VARCHAR(191) NOT NULL DEFAULT 'POS',
    ADD COLUMN `storeId` INTEGER NULL;

-- AlterTable
ALTER TABLE `stock` MODIFY `warehouseId` INTEGER NOT NULL,
    MODIFY `opnameDeviation` DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `username` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Stock_productVariantId_warehouseId_key` ON `Stock`(`productVariantId`, `warehouseId`);

-- CreateIndex
CREATE INDEX `TopProductAggr_storeId_totalSold_idx` ON `TopProductAggr`(`storeId`, `totalSold` DESC);

-- CreateIndex
CREATE UNIQUE INDEX `User_username_key` ON `User`(`username`);

-- AddForeignKey
ALTER TABLE `Stock` ADD CONSTRAINT `Stock_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
