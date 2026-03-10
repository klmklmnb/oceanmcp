export default {
  dateInfo: {
    id: "dateInfo",
    name: "Date Info",
    description:
      "Get the current server date/time or parse a date string, " +
      "returning multiple format representations.",
    type: "code",
    operationType: "read",
    code: `
      const dateStr = args.date;
      const d = dateStr ? new Date(dateStr) : new Date();
      if (isNaN(d.getTime())) {
        return { error: "Invalid date: " + dateStr };
      }
      return {
        iso: d.toISOString(),
        timestamp: d.getTime(),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour: d.getHours(),
        minute: d.getMinutes(),
        second: d.getSeconds(),
        dayOfWeek: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()],
        daysInMonth: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
        isLeapYear: (d.getFullYear() % 4 === 0 && d.getFullYear() % 100 !== 0) || d.getFullYear() % 400 === 0,
      };
    `,
    parameters: [
      {
        name: "date",
        type: "string",
        description:
          "Date string to parse (ISO 8601, etc.). If omitted, uses current date/time.",
        required: false,
      },
    ],
  },

  dateDiff: {
    id: "dateDiff",
    name: "Date Difference",
    description:
      "Calculate the difference between two dates in days, hours, minutes, and seconds.",
    type: "code",
    operationType: "read",
    code: `
      const d1 = new Date(args.from);
      const d2 = new Date(args.to);
      if (isNaN(d1.getTime())) return { error: "Invalid 'from' date: " + args.from };
      if (isNaN(d2.getTime())) return { error: "Invalid 'to' date: " + args.to };

      const diffMs = d2.getTime() - d1.getTime();
      const absDiff = Math.abs(diffMs);
      const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((absDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((absDiff % (1000 * 60)) / 1000);

      return {
        from: d1.toISOString(),
        to: d2.toISOString(),
        direction: diffMs >= 0 ? "forward" : "backward",
        totalMilliseconds: absDiff,
        totalDays: absDiff / (1000 * 60 * 60 * 24),
        breakdown: { days, hours, minutes, seconds },
        humanReadable: days + "d " + hours + "h " + minutes + "m " + seconds + "s",
      };
    `,
    parameters: [
      {
        name: "from",
        type: "string",
        description: "Start date (ISO 8601 format)",
        required: true,
      },
      {
        name: "to",
        type: "string",
        description: "End date (ISO 8601 format)",
        required: true,
      },
    ],
  },
};
