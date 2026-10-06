using Configurator.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Configurator.Api.Migrations
{
    /// <summary>
    /// Adds Models.ShareToken, the stored key behind each model's public configurator
    /// link. Existing models are given a token here so every row has a link.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261005090000_AddModelShareToken")]
    public partial class AddModelShareToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ShareToken",
                table: "Models",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "");

            // NEWID() is evaluated per row, so each existing model gets its own token
            // (32 hex characters, the same shape ShareTokens.New() produces).
            migrationBuilder.Sql(
                "UPDATE [Models] SET [ShareToken] = LOWER(REPLACE(CONVERT(char(36), NEWID()), '-', '')) WHERE [ShareToken] = '';");

            migrationBuilder.CreateIndex(
                name: "IX_Models_ShareToken",
                table: "Models",
                column: "ShareToken",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Models_ShareToken",
                table: "Models");

            migrationBuilder.DropColumn(
                name: "ShareToken",
                table: "Models");
        }
    }
}
